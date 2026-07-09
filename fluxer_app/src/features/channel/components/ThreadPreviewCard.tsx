// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import styles from '@app/features/channel/components/ThreadPreviewCard.module.css';
import Channels from '@app/features/channel/state/Channels';
import ThreadSidebar from '@app/features/channel/state/ThreadSidebar';
import {openThreadContextMenu} from '@app/features/channel/utils/ThreadContextMenuUtils';
import GatewayConnection from '@app/features/gateway/transport/GatewayConnection';
import GuildMembers from '@app/features/member/state/GuildMembers';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import {Message} from '@app/features/messaging/models/MessagingMessage';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {getMessagePreviewText} from '@app/features/messaging/utils/MessagePreviewText';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {http} from '@app/features/platform/transport/RestTransport';
import {Avatar} from '@app/features/ui/components/Avatar';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretRightIcon, ClockIcon} from '@phosphor-icons/react';
import {DateTime} from 'luxon';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const NO_MESSAGES_YET_DESCRIPTOR = msg({
	message: 'No messages yet',
	comment: 'Placeholder in the thread box under a message when the thread has no replies yet.',
});
const EDITED_DESCRIPTOR = msg({
	message: '(edited)',
	comment: 'Suffix shown after a thread preview message that was edited. Keep the parentheses.',
});

// A short tail of recent messages is enough to keep the preview live: the newest
// is shown, and the couple behind it let a deletion fall back to the prior one.
const THREAD_PREVIEW_MESSAGE_LIMIT = 20;

interface ThreadPreviewData {
	name: string | null;
	autoCloseAt: string | null;
	state: number | null;
	lastMessage: Message | null;
}

/**
 * Resolves the thread's authoritative name + auto-close metadata from the parent
 * channel's thread list (accessible to anyone who can view the channel) and
 * surfaces its latest message for the preview row.
 *
 * The last message is fully live: the thread's latest page is loaded into the
 * message store, so the store's MESSAGE_CREATE/UPDATE/DELETE handling keeps the
 * newest message current — new replies, edits, and deletions all reflect without
 * an app refresh. A one-shot fetch seeds the row until the store is ready and
 * covers threads the viewer cannot load messages for.
 */
function useThreadPreview(parentChannelId: string, threadId: string | null): ThreadPreviewData {
	const [data, setData] = useState<ThreadPreviewData>({
		name: null,
		autoCloseAt: null,
		state: null,
		lastMessage: null,
	});
	// Reactive live signals: re-fetch metadata when a new message lands, and prefer
	// the store's newest message (kept live by create/edit/delete handling).
	const liveLastMessageId = threadId ? (Channels.getChannel(threadId)?.lastMessageId ?? null) : null;
	// The per-channel message cache is a plain Map, so reading it is not reactive on
	// its own. Observe the store's change counter — bumped on every create, edit,
	// and delete — so an in-place edit or deletion (which leaves lastMessageId
	// unchanged) still re-renders the preview. Without this the card only refreshed
	// when lastMessageId changed, i.e. on new messages but never on edits/deletes.
	const messagesVersion = Messages.version;
	const storeCollection = threadId ? Messages.getCachedMessages(threadId) : undefined;
	// Once the store has the thread's page it is authoritative: its
	// MESSAGE_CREATE/UPDATE/DELETE handling keeps the newest message live —
	// including edits and deletions. When the store empties out (last message
	// deleted) we fall through to "no messages" rather than the stale one-shot seed.
	const storeReady = messagesVersion >= 0 && (storeCollection?.ready ?? false);
	const storeLast = storeCollection?.last() ?? null;
	// Load the thread's latest page so edits and deletions (not just new messages)
	// flow into the preview through the store.
	useEffect(() => {
		if (!threadId) {
			return;
		}
		void MessageCommands.fetchMessages(threadId, null, null, THREAD_PREVIEW_MESSAGE_LIMIT).catch(() => {});
	}, [threadId]);
	useEffect(() => {
		if (!threadId) {
			setData({name: null, autoCloseAt: null, state: null, lastMessage: null});
			return;
		}
		let cancelled = false;
		void (async () => {
			const [threads, lastWire] = await Promise.all([
				ThreadCommands.listThreads(parentChannelId).catch(() => [] as Array<WireChannel>),
				http
					.get<Array<WireMessage>>(Endpoints.CHANNEL_MESSAGES(threadId), {query: {limit: '1'}})
					.then((response) => response.body[0] ?? null)
					.catch(() => null),
			]);
			if (cancelled) {
				return;
			}
			const threadChannel = threads.find((candidate) => candidate.id === threadId);
			setData({
				name: threadChannel?.thread_metadata?.name ?? threadChannel?.name ?? null,
				autoCloseAt: threadChannel?.thread_metadata?.auto_close_at ?? null,
				state: threadChannel?.thread_metadata?.state ?? null,
				lastMessage: lastWire ? new Message(lastWire) : null,
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [parentChannelId, threadId, liveLastMessageId]);
	return {...data, lastMessage: storeReady ? storeLast : data.lastMessage};
}

function formatCloseLabel(autoCloseAt: string | null, state: number | null): string | null {
	if (state === ThreadStates.ARCHIVED || !autoCloseAt) {
		return null;
	}
	const closeTime = DateTime.fromISO(autoCloseAt);
	if (!closeTime.isValid) {
		return null;
	}
	const relative = closeTime.toRelative();
	const absolute = closeTime.toLocaleString(DateTime.DATE_MED);
	return relative ? `Closes ${relative} · ${absolute}` : `Closes ${absolute}`;
}

export const ThreadPreviewCard = observer(({message}: {message: Message}) => {
	const {i18n} = useLingui();
	const threadId = message.threadId ?? null;
	const guildId = Channels.getChannel(message.channelId)?.guildId ?? null;
	const preview = useThreadPreview(message.channelId, threadId);
	const storeThread = threadId ? Channels.getChannel(threadId) : null;
	// Prefer the live store name so a rename (THREAD_UPDATE) reflects immediately;
	// the fetched metadata and the origin message's snapshot are only fallbacks.
	const threadName = storeThread?.threadMetadata?.name ?? storeThread?.name ?? preview.name ?? message.threadName ?? '';
	const closeLabel = formatCloseLabel(preview.autoCloseAt, preview.state);
	const lastMessage = preview.lastMessage;
	// While the card is visible, take ephemeral access to the thread's live traffic
	// (like the sidebar preview does) so edits and deletions — which never bump
	// lastMessageId — stream into the store and refresh the row. This is needed even
	// for threads the viewer has joined: membership alone does not push a thread's
	// message events while the parent channel is the active view.
	useEffect(() => {
		if (!guildId || !threadId) {
			return;
		}
		GatewayConnection.socket?.subscribeThreadPreview({guildId, threadId});
		return () => {
			GatewayConnection.socket?.unsubscribeThreadPreview({guildId, threadId});
		};
	}, [guildId, threadId]);
	const handleOpen = () => {
		if (!threadId || !guildId) {
			return;
		}
		// On desktop, open the thread as a preview in the right-hand sidebar next
		// to this channel rather than navigating into its full view. The mobile
		// layout has no room for a side panel, so fall back to the full view there.
		// Opening the thread from the channel sidebar always routes to the full view.
		if (MobileLayout.enabled) {
			selectChannel(guildId, threadId);
			return;
		}
		ThreadSidebar.toggle(threadId, message.channelId);
	};
	if (!threadId) {
		return null;
	}
	return (
		<div className={styles.container} data-flx="channel.thread-preview-card">
			<div className={styles.connector} aria-hidden="true" />
			<div className={styles.stack}>
				<button
					type="button"
					className={styles.box}
					onClick={handleOpen}
					onContextMenu={(event) =>
						openThreadContextMenu(event, {
							threadId,
							parentChannelId: message.channelId,
							guildId,
							onGoToThread: handleOpen,
						})
					}
					data-flx="channel.thread-preview-card.open"
				>
					<span className={styles.iconBadge} aria-hidden="true">
						<ThreadIcon size={14} className={styles.icon} data-flx="channel.thread-preview-card.icon" />
					</span>
					<div className={styles.body}>
						<div className={styles.name}>{threadName}</div>
						<div className={styles.lastMessage}>
							{lastMessage ? (
								<>
									<Avatar user={lastMessage.author} size={16} />
									<span
										className={styles.lastAuthor}
										style={{color: GuildMembers.getMember(guildId ?? '', lastMessage.author.id)?.getColorString()}}
									>
										{lastMessage.author.displayName}:
									</span>
									<span className={styles.lastContent}>{getMessagePreviewText(lastMessage, i18n)}</span>
									{lastMessage.editedTimestamp && (
										<span className={styles.lastEdited}>{i18n._(EDITED_DESCRIPTOR)}</span>
									)}
								</>
							) : (
								<span className={styles.lastContent}>{i18n._(NO_MESSAGES_YET_DESCRIPTOR)}</span>
							)}
						</div>
					</div>
					<CaretRightIcon
						size={16}
						weight="bold"
						className={styles.caret}
						data-flx="channel.thread-preview-card.caret"
					/>
				</button>
				{closeLabel && (
					<div className={styles.footer} data-flx="channel.thread-preview-card.footer">
						<ClockIcon size={13} data-flx="channel.thread-preview-card.footer-icon" />
						<span>{closeLabel}</span>
					</div>
				)}
			</div>
		</div>
	);
});
