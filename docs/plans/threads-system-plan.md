# Threads System — Implementation Plan

Status: proposal / planning document — no code changes have been made yet.

## 0. Recap of Fluxer's architecture (context for every section below)

Fluxer is a four-tier system, and a threads feature touches all four:

| Tier | Language / stack | Role |
|---|---|---|
| `fluxer_api` | TypeScript, Hono, custom Cassandra/ScyllaDB query builder | REST API, business logic, persistence |
| `fluxer_gateway` | Erlang/OTP (the "Rust-sounding" crate name is misleading — only two hot-path NIFs are Rust) | Realtime websocket gateway: per-guild `gen_server` processes hold guild state and fan out events to sessions |
| `fluxer_app` | React + MobX (`observer` components, singleton store classes) | Web SPA; `fluxer_desktop` is just an Electron shell that loads this same web app — **no separate desktop UI to build** |
| `fluxer_admin` | Rust, Axum + Askama-style templates | Server-rendered instance admin panel |

Storage is Cassandra/Scylla, not a SQL RDBMS: there's no `migrations/` directory or ORM. Schema-of-record lives in `tools/dev/cassandra_target_schema.json` and is diffed/applied by `tools/dev/src/cassandra.rs`. The TypeScript row types actually used by query code live in `fluxer_api/src/api/database/types/{ChannelTypes,MessageTypes}.ts`.

Snowflake IDs are minted by a dedicated Rust service (`fluxer_snowflakes`) over NATS; `fluxer_api/src/api/infrastructure/SnowflakeService.ts` already has a `generateForChannel(channelId)` method using a `channel:<id>` routing key — directly reusable for per-thread ID minting (thread IDs must be snowflakes per the spec, exactly like channel IDs).

The closest existing precedent for "a channel nested under another channel" is **categories**: a category is just a `channels` row with `type = GUILD_CATEGORY`, and ordinary channels point at it via `channels.parent_id`. There is currently no forum/thread channel type, no thread tables, and no thread-scoped gateway events. This plan adds all three.

---

## 1. Data model

### 1.1 New channel type

Add `GUILD_THREAD` to `ChannelTypes` in `packages/constants/src/ChannelConstants.ts`. A thread is stored as a row in the existing `channels` table:

- `channel_id` = the thread's own snowflake (this **is** the `ThreadID` used in message-link URLs and doubles as the thread's partition key for messages, exactly like any other channel).
- `parent_id` = the parent channel's ID (existing column, same mechanism categories already use — this is the `ChannelID` in the link format `.../CHANNELID/THREADID/...`).
- `guild_id` = inherited from the parent channel unchanged.

### 1.2 `channels` table additions

Per the explicit backend requirement, add these columns even though some are redundant with existing ones for a thread-typed row (kept as explicit columns so thread rows are trivially filterable/indexable without a `type` scan, and so "thread name" is a distinct concept from the generic `name` field used across all channel types):

```
thread_id            bigint      -- == channel_id for thread rows, null for non-thread channels
thread_name          text        -- thread display name, null for non-thread channels
thread_creator_id    bigint      -- snapshot of the creating user's ID
thread_creator_name  text        -- snapshot of the creating user's username at creation time
thread_state         tinyint     -- 0 = open, 1 = closed, 2 = archived
thread_auto_close_duration_seconds int  -- one of 3600 / 86400 / 259200 / 604800 (1h / 24h / 3d / 7d), chosen at creation
thread_auto_close_at timestamp   -- last_message_time + thread_auto_close_duration_seconds; recomputed on every new message (see §3.1)
thread_last_message_id bigint    -- convenience denorm, mirrors last_message_id but avoids ambiguity in UI code that lists threads by last activity
```

`parent_id` is already a standard column, satisfying "parent channel should be included as standard." `channel_id`'s own snowflake timestamp already satisfies "creation time and creating user should reflect thread not parent channel" for the *time* component; `thread_creator_id`/`thread_creator_name` cover the *user* component (a live-lookup `owner_id`-style field isn't enough because the spec wants the username **as it was at creation time**, which can drift if the user later changes their name).

### 1.3 `messages` table additions

```
thread_id    bigint   -- set on the origin message (the message a thread was started from), null otherwise
thread_name  text     -- denormalized copy of the thread's name, refreshed on rename
```

These live on the **origin message row in the parent channel**, not on messages sent inside the thread (those are already correctly scoped by `channel_id = thread_id` under the existing per-channel message-bucket partitioning — no schema change needed for thread replies themselves). This is what lets the client render "indented thread box below the original message" directly from the message object the channel already fetched, with no extra round trip. Renaming a thread requires a single-row patch to the origin message's `thread_name` (already-existing `executeVersionedUpdate` patch pattern in `CassandraVersionedUpdate.ts` covers this).

### 1.4 New table: `thread_members`

Needed because thread visibility/membership is **not** the same as channel role-permission visibility — joining is opt-in (creator, message-senders, or explicit join action), and membership must survive archive/unarchive cycles ("when a thread is un-archived, all members are automatically rejoined").

```
thread_id  bigint
user_id    bigint
joined_at  timestamp
PRIMARY KEY (thread_id, user_id)
```

Plus a reverse-lookup table `thread_members_by_user (user_id, thread_id) PRIMARY KEY (user_id, thread_id)` so a client's "READY" payload / resume flow can efficiently answer "which threads is this user currently in" to seed the sidebar (mirrors the existing `MessagesByAuthorV2`-style reverse-index pattern already used for messages).

Add both tables to `cassandra_target_schema.json` and `Tables.ts`.

### 1.5 Why not a brand-new "sub-channel" concept instead of reusing `channels`?

Reusing the `channels` table (new type + extra columns) means threads get permission overwrites, gateway dispatch, message storage/buckets, pins, read-states, etc. for free, since all of that machinery already keys off `channel_id`. A parallel bespoke table would require re-deriving all of it. This mirrors how categories were done and is the lowest-risk path.

---

## 2. Permissions

### 2.1 New permission bit

Add to `Permissions` in `packages/constants/src/ChannelConstants.ts`, in one of the unused bit slots (e.g. `CREATE_THREADS: 1n << 55n` — bit numbering already has gaps from prior features, so no renumbering needed):

```ts
CREATE_THREADS: 1n << 55n,
```

Add a description entry in `PermissionsDescriptions`, and a client-facing label/description in `fluxer_app/src/features/permissions/utils/PermissionLabelDescriptors.ts` (category `messagesMedia`), plus a channel-type gate in `fluxer_app/src/features/permissions/utils/PermissionUtils.ts` (`generateChannelPermissionSpecs`) so the permission only appears in the role/overwrite editor for `GUILD_TEXT` channels.

### 2.2 Default-on behavior

- **New communities**: add `CREATE_THREADS` to `DEFAULT_PERMISSIONS` so `@everyone` gets it automatically (the guild-creation code in `GuildOperationsService.ts` spreads `DEFAULT_PERMISSIONS` without change — no code edit needed there beyond the constant).
- **Existing communities (migration)**: a one-time backfill job that, for every existing role that currently holds `MANAGE_GUILD` or `MANAGE_CHANNELS`, ORs in `CREATE_THREADS` (per spec: "this permission should be automatically turned on for any role with manage community or manage channel permissions in existing communities"). This does **not** touch `@everyone` for existing communities — only new communities get it on `@everyone` by default. Implemented as a one-off backfill script (see §7, Rollout) rather than a runtime migration, since Cassandra has no schema-level default backfill mechanism.

### 2.3 Enforcement of thread lifecycle actions

- **Create thread**: requires `CREATE_THREADS` on the parent channel (checked via the existing `AuthenticatedChannel`/`checkPermission` pattern, e.g. `MessagePinService.ts`'s `checkPermission(Permissions.PIN_MESSAGES)` is the template).
- **Close / open / archive / unarchive / delete thread**: reuse `Permissions.MANAGE_CHANNELS` (the spec explicitly scopes these to "individuals with manage channel permissions"), following the same pattern as channel update/delete in `ChannelOperationsService.ts`.
- **Unarchive specifically**: per spec, archived threads "cannot be opened except by a moderator" — enforced as `MANAGE_CHANNELS`-only, distinct from "close→open" which any thread member can trigger by sending a message.
- **Race condition (permission revoked while the create-thread modal is open)**: no special client-side handling — the modal's confirm handler just calls the create-thread endpoint, the server re-checks `CREATE_THREADS` at request time via the normal `checkPermission` path, and a `403`/`MissingPermissionsError` naturally results in the client's existing generic mutation-error handling (toast/console). Per spec, no bespoke UX is required beyond a console error, so no additional client code path is needed here — the existing "action rejected by server" plumbing already logs to console.

---

## 3. Backend API (`fluxer_api`)

New/changed endpoints, mirroring the existing channel-controller conventions (`GuildChannelController.ts`, `MessageController.ts`):

- `POST /channels/:channelId/threads` — create a thread.
  - Body: `{ name, auto_close_duration_seconds, message_id? }`, where `auto_close_duration_seconds` is one of four fixed presets — `3600` (1h), `86400` (24h), `259200` (3d), `604800` (7d, the default) — matching Discord's reference points; the server rejects any other value with a 400 rather than accepting an arbitrary duration. If `message_id` is present the thread is rooted on that message (writes `messages.thread_id`/`thread_name` on it); if absent (the `/thread` slash-command path with no message context) the thread has no origin message.
  - Validates `CREATE_THREADS` permission on the parent channel.
  - Validates "already a thread root on this message" → **join instead of duplicate-create** (spec: "if the message is already the start of a thread... they should not be able to start a secondary thread" — this is enforced server-side too, not just hidden client-side, since the UI affordance alone isn't a security boundary).
  - Mints `thread_id` via `SnowflakeService.generateForChannel(parentChannelId)`, inserts the `channels` row (type `GUILD_THREAD`, `thread_auto_close_duration_seconds` from the request, `thread_auto_close_at = now() + duration`), inserts a `thread_members` row for the creator, dispatches `THREAD_CREATE` (see §4).
- `GET /channels/:channelId/threads` — list all threads (open, closed, archived) under a channel, ordered by last-message-timestamp descending, for the "thread list" topbar dropdown. Response includes `last_message` preview + author, matching the pinned-messages dropdown's existing response shape for UI reuse.
- `POST /threads/:threadId/join` — insert into `thread_members` (+ reverse index), dispatch `THREAD_MEMBER_ADD`.
- `POST /threads/:threadId/leave` — delete from `thread_members`, dispatch `THREAD_MEMBER_REMOVE`. Rejected (400) if `thread_state == ARCHIVED` (spec: no leave option on archived threads).
- `PATCH /threads/:threadId` — state transitions (`open`, `close`, `archive`, `unarchive`) and rename. Each transition checked against §2.3's permission rules. `unarchive` re-inserts `thread_members` rows for everyone previously recorded (they were never deleted on archive, only "deactivated" from a delivery standpoint — see §4.3) and dispatches `THREAD_MEMBER_ADD` for each, satisfying "all members are automatically rejoined." `unarchive` and any manual `open` also recompute `thread_auto_close_at = now() + thread_auto_close_duration_seconds` so the thread doesn't immediately re-expire on the next sweep.
- `DELETE /threads/:threadId` — soft-delete like normal channel delete, `MANAGE_CHANNELS` required.
- Sending a message in a thread reuses the **existing** `POST /channels/:channelId/messages` endpoint unchanged (a thread is just a channel) — this is also what auto-transitions a closed thread back to `open`, auto-joins the sender, and resets the auto-close timer (a `MessageSendService` hook: after a successful send, if `channel.type === GUILD_THREAD`, upsert `thread_members` for the author, flip `thread_state` to `open` if it was `closed`, and set `thread_auto_close_at = now() + thread_auto_close_duration_seconds`). This is what makes the auto-close measure "time since last message" rather than a fixed deadline from creation — every new message pushes the deadline back out.
- Slash command `/thread`: no new endpoint — the client-side `/thread` command just opens the same create-thread modal client-side (see §5.4), which then calls the same `POST /channels/:channelId/threads` with no `message_id`.
- Permission-gated visibility of the affordances themselves (buttons, `/thread` autocomplete) is a client-side check against the same cached permission state already used everywhere else (`fluxer_app/src/features/permissions/utils/PermissionUtils.ts`'s `computePermissions()`), no new endpoint needed.

Response DTO mapping (`mapChannelToResponse`) needs a thread-aware branch to include `thread_id`, `thread_name`, `parent_id`, `thread_state`, `thread_auto_close_duration_seconds`, `thread_auto_close_at`, membership flag for the requesting user, and last-message preview.

### 3.1 Auto-close scheduler

Cassandra has no native TTL-triggered callback, so auto-closing on inactivity needs an active sweep rather than a passive expiry. Add a new periodic worker to `fluxer_svc` (the existing Rust service tier that already hosts background/infrastructure workers) that:

- Runs on a fixed interval (e.g. every 60s — frequent enough that a 1h-duration thread doesn't stay open noticeably past its deadline, cheap enough not to matter at any realistic thread volume).
- Queries for threads with `thread_state == OPEN and thread_auto_close_at < now()` (a secondary index or a materialized view keyed by `thread_auto_close_at` is required for this query pattern, since Cassandra can't efficiently range-scan a non-partition-key column across all threads — add a `threads_by_auto_close_at` lookup table analogous to the existing `thread_members_by_user` reverse-index pattern, repopulated/updated whenever `thread_auto_close_at` changes).
- For each match, flips `thread_state` to `CLOSED` (not `ARCHIVED` — auto-close only ever produces the "closed" state per spec; archiving remains a manual moderator action) via the same `PATCH`-equivalent internal service call used by the manual "close" action, and dispatches `THREAD_UPDATE`.
- This worker is purely a timer — it never touches `thread_members`, so closing has no effect on membership/visibility, consistent with §4.3's "closed just blocks nothing, it's a flag" model.

---

## 4. Gateway / realtime (`fluxer_gateway`, Erlang)

### 4.1 New events

Add to both `fluxer_gateway/src/utils/event_atoms.erl` and `fluxer_api/src/api/constants/Gateway.ts`:

```
THREAD_CREATE, THREAD_UPDATE, THREAD_DELETE,
THREAD_MEMBER_ADD, THREAD_MEMBER_REMOVE,
THREAD_LIST_SYNC   -- sent to a session when it previews/opens the thread dropdown, batch snapshot
```

Ordinary `MESSAGE_CREATE`/`MESSAGE_UPDATE`/`TYPING_START`/etc. need no new event variants — they already work unchanged for a thread's own channel-scoped traffic since a thread is a channel.

### 4.2 Dispatch-filter wiring

Extend `guild_dispatch_filter.erl`'s `is_channel_scoped_event/1` to mark `thread_create`, `thread_update`, `thread_delete` as channel-scoped against the **parent** channel (so anyone who can currently view the parent channel receives the "a thread exists" notice — this is required for the "preview" UX, see §4.3), while `thread_member_add`/`thread_member_remove` are scoped to the **thread's own** channel_id (only relevant to people who can already see the thread).

### 4.3 Visibility model: preview vs. joined vs. closed/archived

This is the one place needing genuinely new gateway logic, because thread visibility isn't pure role-permission visibility (§ research finding: normal channel visibility is computed from cached `viewable_channels`, but thread membership is per-user opt-in state layered on top).

- **Joined members**: get full, persistent visibility — model this with the existing `guild_virtual_channel_access.erl` primitive (currently only used for voice-channel presence), extended to grant a user virtual access to a thread's `channel_id` for as long as their `thread_members` row exists. Access is granted on `THREAD_MEMBER_ADD` and revoked on `THREAD_MEMBER_REMOVE`/leave.
- **Preview (clicked into a thread but not joined)**: a new **ephemeral, connection-scoped** virtual access grant, analogous to the client-driven range-subscription flow already used for member lists (`guild_unified_subscriptions.erl`/`guild_member_list_subscribe.erl` is the closest existing pattern for "client tells gateway what it's currently looking at"). Client sends a lightweight `subscribe_thread_preview`/`unsubscribe_thread_preview` gateway op when entering/leaving the thread view; the gateway grants/revokes virtual access for that session only, without touching `thread_members`. This is what makes the thread disappear from the sidebar the instant the client navigates away, per spec, without any persisted state.
- **Closed threads**: still fully visible/joinable to existing members (closed just blocks... nothing, actually — per spec, sending a message reopens a closed thread, so "closed" is really just a state flag with no visibility restriction, only an implicit "needs a message (or explicit reopen) to flip back to open" gate).
- **Archived threads**: existing members' `thread_members` rows are preserved but their virtual channel access is **revoked** while archived (matches "closed threads → preview state until reopened" and "archived cannot be opened except by a moderator"); `unarchive` re-grants virtual access to every preserved member and re-dispatches `THREAD_MEMBER_ADD` to each.

### 4.4 Bots

Per research, bots use the exact same session/gateway pipeline as human clients with no separate intents system — the new `THREAD_*` events reach bots automatically once dispatch-filter wiring (§4.2) is in place, satisfying "bots should be able to listen for thread events" with no bot-specific code. Bot actions (send message, join, close, etc.) go through the same REST endpoints in §3, satisfying "anything a user can do in a thread, a bot should be able to do" — no bot-specific gating needed since permission checks are identity-based, not human-vs-bot.

---

## 5. Frontend (`fluxer_app` — covers both desktop Electron shell and web, since they share this UI)

All file paths below are existing files to extend, found via codebase research; new files are marked **(new)**.

### 5.1 Starting a thread

- **Hover toolbar**: `fluxer_app/src/features/channel/components/MessageActionBar.tsx` — insert a new `MessageActionBarButton` between the existing Reply (`ReplyIcon`, line ~739) and Forward (`ForwardIcon`, line ~749) buttons. Add `ThreadIcon` export to `fluxer_app/src/features/ui/action_menu/ContextMenuIcons.tsx` (Phosphor Icons is the icon library already in use — e.g. `ReplyPreview.tsx` uses `ArrowBendUpLeftIcon` from `@phosphor-icons/react`; a Phosphor "chats"/"thread" glyph is the natural fit). Tooltip text: `"Start new thread"`, or `"Join thread"` when `message.thread_id != null`, in which case the click action is "join and navigate" instead of "open create modal."
- **Right-click / hamburger context menu**: `fluxer_app/src/features/channel/components/MessageActionMenu.tsx`, sharing the click-handler + permission logic with the hover bar via `fluxer_app/src/features/channel/components/MessageActionUtils.tsx` (`createMessageActionHandlers`, `useMessagePermissions`) — add a `canStartThread`/`hasThread` computed flag there so both surfaces stay in sync.
- **Permission gating**: both the hover icon and context-menu entry are simply omitted (not disabled) when `useMessagePermissions()` reports no `CREATE_THREADS` on the channel — matches spec ("will not see any of the buttons").
- **`/thread` slash command**: register in `fluxer_app/src/features/devtools/hooks/useCommands.ts` as a new `ActionCommand` (alongside `/nick`, `/kick` etc.), gated by the same `CREATE_THREADS` permission check so it's excluded from autocomplete entirely when the user lacks it (mirrors how other permission-gated commands like `/kick` are filtered in `useTextareaAutocomplete.ts`'s `canUseCommand`). No new regex needed in `SlashCommandUtils.ts` since `/thread` takes no inline arguments — it just opens the modal.
- **Create-thread modal (new)**: `fluxer_app/src/features/channel/components/modals/ThreadCreateModal.tsx`, modeled directly on `ChannelCreateModal.tsx` (name `Input` + `RadioGroup`/duration selector, same `Modal.Root`/`Modal.Footer` shell, `useFormSubmit`) with the first-message preview block borrowed from `ForwardModal.tsx`'s message-preview rendering (omitted entirely when opened via `/thread`, which has no message context). Fields: Thread Name, a `RadioGroup` of exactly four auto-close duration presets — 1 hour / 24 hours / 3 days / 7 days — with 7 days pre-selected as the default (matching Discord's reference points, per §3), message preview, Confirm/Cancel. The field posts as `auto_close_duration_seconds` to `POST /channels/:channelId/threads` (§3). Supporting utils in a new `ThreadCreateModalUtils.ts` (mirrors `ChannelCreateModalUtils.ts`).
- **Thread preview box under the origin message**: **(new)** `ThreadPreviewCard.tsx`, rendered inline in the message list whenever a message has `thread_id` set (read directly off the message object, no extra fetch — this is exactly why `messages.thread_id`/`thread_name` are denormalized per §1.3). Styled with a `primary-accent`-colored outline, showing thread name, last-message timestamp, last message text, last-message author name + avatar. The connecting line reuses the same visual language as the existing reply-connector affordance (`ArrowBendUpLeftIcon`-based indicator already used in `ReplyPreview.tsx`/`ChannelTextarea.tsx`) rotated/positioned to come out of the message's left edge into the box.

### 5.2 Thread UX (topbar + sidebar)

- **Topbar**: `fluxer_app/src/features/channel/components/ChannelHeader.tsx` — when the active channel is a thread, swap the `#`-style icon (currently resolved via `ChannelUtils.getIcon()` in `fluxer_app/src/features/channel/utils/ChannelUtils.tsx`) for a thread icon; add a `channel.type === GUILD_THREAD` branch to `getIcon()`.
- **Threads-list icon**: new `ChannelHeaderIcon`-pattern button inserted between the existing `ChannelPinsButton` (line ~925) and the favorites/star block (line ~943) in `ChannelHeader.tsx`. Clicking opens a scrollable dropdown (new component, styled after the existing pinned-messages dropdown) listing all threads (open + closed + archived) for the channel, each rendered as a box (name, last-message timestamp, last message + sender avatar), fetched via `GET /channels/:channelId/threads` and **not** re-sorted while open (per spec — client fetches once per open, does not live-resort).
- **Right-click on a thread row in that dropdown**: context menu with `join`/`close`/`open`/`archive`/`unarchive`/`delete`, each item visible only if the acting user's permissions/membership satisfy §2.3 (e.g. `join` hidden if already a member; `unarchive`/`delete`/`close`/`open` hidden without `MANAGE_CHANNELS`).
- **Sidebar**: `fluxer_app/src/features/app/components/layout/ChannelListContent.tsx` already builds a one-level channel/category tree grouped by `parent_id` (this logic is factored out in `packages/schema/src/domains/channel/GuildChannelOrdering.ts`, e.g. `sortChannelsForOrdering`). Extend this to a second nesting level: for each channel, render its threads (only those the user has *joined* — from `thread_members_by_user`, seeded at `READY`/resume, kept live via `THREAD_MEMBER_ADD`/`REMOVE` — **plus** any thread currently in the ephemeral client-side "preview" set from §4.3) directly beneath it, ordered by `thread_id` ascending (creation order, per spec), before the next sibling channel. This requires a MobX store, `fluxer_app/src/features/channel/state/Threads.ts` **(new)**, mirroring the shape of `Channels.ts` (`@observable` joined + previewed thread maps, computed per-channel getters), fed by the new gateway events.
- **Preview-then-disappear behavior**: clicking a thread link/preview-card navigates to it and adds it to the ephemeral "previewed" set (and sends the `subscribe_thread_preview` op from §4.3); navigating to any other channel/thread removes it from that set (and unsubscribes) unless the user has actually joined it in the meantime (e.g. by sending a message), which is exactly the difference between "preview" and "joined" state the spec calls out.
- **Closed/archived + entering preview state**: clicking a closed or archived thread you're a member of still opens it, but read-only preview semantics apply until reopened — the client checks `thread_state` from the already-loaded channel object; no extra request needed.

### 5.3 Joining / leaving

- **Auto-join triggers**: creating a thread, sending a message in it (handled server-side per §3, reflected to the client via `THREAD_MEMBER_ADD` for the local user), or clicking "Join thread" (hover icon / context menu when message already has a thread) all converge on the same client mutation → `POST /threads/:id/join`, then navigate into it.
- **Leave**: right-click a thread in the sidebar → "Leave thread" (new context-menu item, `fluxer_app`'s existing channel-sidebar right-click menu component is the natural home — visible only for `thread_state` `open`/`closed`, hidden for `archived`, per spec) → `POST /threads/:id/leave`.
- **Reopen**: right-click a closed thread → "Open" (only for `MANAGE_CHANNELS` holders, per spec — anyone can reopen just by sending a message, but the explicit menu action is moderator-only) → `PATCH /threads/:id { state: open }`.

### 5.4 Notes on `/thread` and permission changes mid-modal

Already covered in §2.3/§5.1 — no bespoke UI, relies on the existing generic mutation-error → console path.

---

## 6. Admin panel (`fluxer_admin`, Rust)

### 6.1 Community detail page

`fluxer_admin/src/templates/pages/guild_detail_tabs/overview.rs` currently renders a flat "Channels (N)" card built from `sorted_channels`/`channels_by_id`. Changes:
- Categories render as a plain text label, `CATEGORYNAME (ID)`, in the upper-left corner of their section — no bordered box (spec explicitly downgrades the current boxed category rendering).
- Each channel gets a caret/expand toggle if it has threads; expanding reveals its threads indented beneath it.
- Thread rows render at half the height of a normal channel row, slightly indented, showing `THREADNAME - THREADID` on the left and `Thread` as the type label on the right (mirroring the existing type-label column already used for regular channels).
- Ordering: channels/threads/categories listed in instance order (same `position`/hierarchy-derived order already computed for the existing channel list — no new ordering logic, just extended to include threads at their natural place under their parent).

### 6.2 Message Tools

`fluxer_admin/src/routes/messages.rs` + `fluxer_admin/src/templates/pages/messages_page.rs` already accept a `channel_id` query param for "Browse Channel." Changes:
- Accept either a channel ID or thread ID in the same input field; look up the target row and branch on `type == GUILD_THREAD`.
- Label switches to "Browse Thread" when the target is a thread.
- Add the breadcrumb line specified: `Channel Name (link) / Thread Name (link) / Thread started by: USERNAME (link) in Community (link)` — the community link goes to the guild detail page (`guild_detail.rs`), the channel link goes to "Browse Channel" for the parent (`parent_id`), the thread link is the current page, and the username link goes to the existing user-detail admin page. `thread_creator_id`/`thread_creator_name` (§1.2) supply the username/link directly without an extra live user lookup.

---

## 7. Rollout

- **Permission backfill** (§2.2): one-off script backfilling `CREATE_THREADS` onto roles with `MANAGE_GUILD`/`MANAGE_CHANNELS` across all existing guilds. Run once at deploy time, not a runtime code path.
- **Admin notification popup**: "Enable threads for your members!" attached to the community name in the sidebar for admins of pre-existing communities. New per-user-per-guild dismissal flag (reuse the existing `UserGuildSettings` per-guild-per-user settings row/table rather than inventing a new one — add a `threads_announcement_dismissed boolean` column there), checked client-side to decide whether to render the popup. Dismissed by clicking the popup itself **or** clicking the community name (per spec, both are equivalent no-op-except-dismiss actions the first time).
- **New communities post-launch**: no popup (feature is on by default per §2.2), no backfill needed.

---

## 8. Suggested implementation phases

1. **Schema & permissions** — `cassandra_target_schema.json` + `Tables.ts` additions (§1), new `Permissions.CREATE_THREADS` bit + label wiring (§2), permission backfill script.
2. **Backend core** — thread CRUD endpoints, join/leave, state transitions, origin-message annotation, snowflake minting, and the `fluxer_svc` auto-close sweep worker + `threads_by_auto_close_at` lookup table (§3).
3. **Gateway** — new event atoms, dispatch-filter wiring, virtual-access-based visibility model for joined/preview/archived states, preview subscribe/unsubscribe op (§4).
4. **Frontend initiation** — hover icon, context-menu entry, `/thread` command, create-thread modal, thread-preview card under origin messages (§5.1).
5. **Frontend thread UX** — topbar icon swap + threads-list dropdown, sidebar nesting with joined/preview state, MobX `Threads` store (§5.2).
6. **Frontend join/leave/manage** — join/leave/open/close/archive/unarchive context-menu actions wired to §3's endpoints (§5.3).
7. **Admin panel** — community-detail thread nesting + category de-boxing, Message Tools thread support (§6).
8. **Rollout** — backfill run, admin announcement popup (§7).
9. **Docs** — publish the new `THREAD_*` gateway events and REST endpoints in `fluxer_docs/docs/gateway` and the relevant API reference pages, since bots rely on published gateway docs to build against this feature.

Each phase is independently testable and mostly independently shippable behind the `CREATE_THREADS` permission gate (nothing renders/activates for a community until at least one role has the bit), so phases 1–3 (invisible backend plumbing) can land well ahead of the visible frontend phases without user-facing risk.

---

## 9. Resolved decisions

The following were previously open questions and are now settled:

- **Auto-close duration options**: fixed presets of 1h / 24h / 3d / 7d, matching Discord's reference points (§3, §5.1).
- **What the duration measures**: time since the thread's *last message*, not time since creation — every new message resets `thread_auto_close_at` (§1.2, §3).
- **Auto-close scheduler mechanism**: a new periodic `fluxer_svc` worker sweeping for `thread_state == OPEN and thread_auto_close_at < now()`, backed by a new `threads_by_auto_close_at` lookup table since Cassandra can't range-scan a non-partition-key column directly (§3.1).
