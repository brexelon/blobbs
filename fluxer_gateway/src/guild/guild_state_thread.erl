%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Thread visibility state transitions.
%%
%% Threads are not part of the guild's channel list, so a member's ability to
%% receive a thread's channel-scoped events (messages, typing, membership) is
%% modelled as per-user virtual channel access rather than role-derived channel
%% visibility. These handlers translate the THREAD_MEMBER_ADD / THREAD_MEMBER_REMOVE
%% / THREAD_UPDATE dispatches from the API into grants and revocations against
%% guild_virtual_channel_access, so the ordinary session filter
%% (guild_sessions:session_can_view_channel/3) then delivers thread traffic to
%% exactly the joined members.

-module(guild_state_thread).
-typing([eqwalizer]).

-export([
    handle_member_add/2,
    handle_member_remove/2,
    handle_thread_update/2,
    handle_preview_subscribe/3,
    handle_preview_unsubscribe/3
]).

-type guild_state() :: map().
-type event_data() :: map().
-type user_id() :: integer().
-type channel_id() :: integer().
-export_type([guild_state/0, event_data/0]).

%% Thread lifecycle state matching packages/constants ThreadStates.
-define(THREAD_STATE_ARCHIVED, 2).

-spec handle_member_add(event_data(), guild_state()) -> guild_state().
handle_member_add(EventData, State) ->
    case {parse_user_id(EventData), parse_thread_id(EventData)} of
        {UserId, ThreadId} when is_integer(UserId), is_integer(ThreadId) ->
            State1 = guild_virtual_channel_access:add_virtual_access(UserId, ThreadId, State),
            %% A real join supersedes any prior preview grant: clearing the preview
            %% mark ensures a later unsubscribe_thread_preview (e.g. from another tab
            %% still showing the thread) cannot revoke a genuine member's access.
            guild_virtual_channel_access:clear_thread_preview(UserId, ThreadId, State1);
        _ ->
            State
    end.

-spec handle_member_remove(event_data(), guild_state()) -> guild_state().
handle_member_remove(EventData, State) ->
    case {parse_user_id(EventData), parse_thread_id(EventData)} of
        {UserId, ThreadId} when is_integer(UserId), is_integer(ThreadId) ->
            guild_virtual_channel_access:remove_virtual_access(UserId, ThreadId, State);
        _ ->
            State
    end.

%% When a thread is archived, revoke every member's virtual access so archived
%% threads fall back to the preview (read-only, not live) state. Unarchive is
%% handled by the API re-dispatching THREAD_MEMBER_ADD for each preserved member,
%% which flows through handle_member_add/2 above.
-spec handle_thread_update(event_data(), guild_state()) -> guild_state().
handle_thread_update(EventData, State) ->
    case {thread_id_from_channel(EventData), thread_state(EventData)} of
        {ThreadId, ?THREAD_STATE_ARCHIVED} when is_integer(ThreadId) ->
            revoke_all_access(ThreadId, State);
        _ ->
            State
    end.

%% A preview grant makes a thread's channel-scoped events visible to a user who
%% is looking at (but has not joined) the thread. If the user can already see the
%% thread — because they are a joined member, or an earlier preview from this user
%% is still active — there is nothing to grant. Otherwise grant virtual access and
%% remember it as preview-originated so the matching unsubscribe can revoke it
%% (and only it, never a real membership).
-spec handle_preview_subscribe(user_id(), channel_id(), guild_state()) -> guild_state().
handle_preview_subscribe(UserId, ThreadId, State) ->
    case guild_virtual_channel_access:has_virtual_access(UserId, ThreadId, State) of
        true ->
            State;
        false ->
            State1 = guild_virtual_channel_access:add_virtual_access(UserId, ThreadId, State),
            guild_virtual_channel_access:mark_thread_preview(UserId, ThreadId, State1)
    end.

%% Revoke a preview-originated grant. The preview mark is the guard: a thread the
%% user genuinely joined has no mark (handle_member_add clears it), so its access
%% survives an unsubscribe.
-spec handle_preview_unsubscribe(user_id(), channel_id(), guild_state()) -> guild_state().
handle_preview_unsubscribe(UserId, ThreadId, State) ->
    case guild_virtual_channel_access:has_thread_preview(UserId, ThreadId, State) of
        true ->
            State1 = guild_virtual_channel_access:remove_virtual_access(UserId, ThreadId, State),
            guild_virtual_channel_access:clear_thread_preview(UserId, ThreadId, State1);
        false ->
            State
    end.

-spec revoke_all_access(channel_id(), guild_state()) -> guild_state().
revoke_all_access(ThreadId, State) ->
    Users = guild_virtual_channel_access:get_users_with_virtual_access(ThreadId, State),
    lists:foldl(
        fun(UserId, AccState) ->
            guild_virtual_channel_access:remove_virtual_access(UserId, ThreadId, AccState)
        end,
        State,
        Users
    ).

-spec parse_user_id(event_data()) -> user_id() | undefined.
parse_user_id(EventData) ->
    guild_dispatch_decorate:parse_snowflake(
        <<"user_id">>, maps:get(<<"user_id">>, EventData, undefined)
    ).

-spec parse_thread_id(event_data()) -> channel_id() | undefined.
parse_thread_id(EventData) ->
    guild_dispatch_decorate:parse_snowflake(
        <<"thread_id">>, maps:get(<<"thread_id">>, EventData, undefined)
    ).

-spec thread_id_from_channel(event_data()) -> channel_id() | undefined.
thread_id_from_channel(EventData) ->
    guild_dispatch_decorate:parse_snowflake(
        <<"id">>, maps:get(<<"id">>, EventData, undefined)
    ).

-spec thread_state(event_data()) -> integer() | undefined.
thread_state(EventData) ->
    Metadata = maps:get(<<"thread_metadata">>, EventData, #{}),
    normalize_state(maps:get(<<"state">>, ensure_map(Metadata), undefined)).

-spec ensure_map(term()) -> map().
ensure_map(Map) when is_map(Map) -> Map;
ensure_map(_) -> #{}.

-spec normalize_state(term()) -> integer() | undefined.
normalize_state(State) when is_integer(State) -> State;
normalize_state(State) when is_binary(State) ->
    try
        binary_to_integer(State)
    catch
        error:badarg -> undefined
    end;
normalize_state(_) -> undefined.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

handle_member_add_grants_virtual_access_test() ->
    State = #{id => 1, sessions => #{}},
    EventData = #{<<"thread_id">> => <<"99">>, <<"user_id">> => <<"7">>, <<"guild_id">> => <<"1">>},
    Updated = handle_member_add(EventData, State),
    ?assertEqual(true, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)).

handle_member_remove_revokes_virtual_access_test() ->
    State0 = #{id => 1, sessions => #{}},
    Granted = guild_virtual_channel_access:add_virtual_access(7, 99, State0),
    EventData = #{<<"thread_id">> => <<"99">>, <<"user_id">> => <<"7">>},
    Updated = handle_member_remove(EventData, Granted),
    ?assertEqual(false, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)).

handle_member_add_ignores_missing_fields_test() ->
    State = #{id => 1, sessions => #{}},
    ?assertEqual(State, handle_member_add(#{<<"thread_id">> => <<"99">>}, State)),
    ?assertEqual(State, handle_member_add(#{<<"user_id">> => <<"7">>}, State)).

handle_thread_update_archive_revokes_all_test() ->
    State0 = #{id => 1, sessions => #{}},
    State1 = guild_virtual_channel_access:add_virtual_access(7, 99, State0),
    State2 = guild_virtual_channel_access:add_virtual_access(8, 99, State1),
    EventData = #{<<"id">> => <<"99">>, <<"thread_metadata">> => #{<<"state">> => 2}},
    Updated = handle_thread_update(EventData, State2),
    ?assertEqual(false, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)),
    ?assertEqual(false, guild_virtual_channel_access:has_virtual_access(8, 99, Updated)).

handle_thread_update_non_archive_preserves_access_test() ->
    State0 = #{id => 1, sessions => #{}},
    State1 = guild_virtual_channel_access:add_virtual_access(7, 99, State0),
    EventData = #{<<"id">> => <<"99">>, <<"thread_metadata">> => #{<<"state">> => 0}},
    Updated = handle_thread_update(EventData, State1),
    ?assertEqual(true, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)).

handle_preview_subscribe_grants_and_marks_test() ->
    State0 = #{id => 1, sessions => #{}},
    Updated = handle_preview_subscribe(7, 99, State0),
    ?assertEqual(true, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)),
    ?assertEqual(true, guild_virtual_channel_access:has_thread_preview(7, 99, Updated)).

handle_preview_subscribe_is_noop_when_already_visible_test() ->
    State0 = #{id => 1, sessions => #{}},
    Joined = guild_virtual_channel_access:add_virtual_access(7, 99, State0),
    Updated = handle_preview_subscribe(7, 99, Joined),
    %% A joined member gains no preview mark, so a later unsubscribe cannot revoke them.
    ?assertEqual(false, guild_virtual_channel_access:has_thread_preview(7, 99, Updated)),
    ?assertEqual(true, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)).

handle_preview_unsubscribe_revokes_preview_test() ->
    State0 = #{id => 1, sessions => #{}},
    Subscribed = handle_preview_subscribe(7, 99, State0),
    Updated = handle_preview_unsubscribe(7, 99, Subscribed),
    ?assertEqual(false, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)),
    ?assertEqual(false, guild_virtual_channel_access:has_thread_preview(7, 99, Updated)).

handle_preview_unsubscribe_preserves_membership_test() ->
    State0 = #{id => 1, sessions => #{}},
    %% Member joins (clearing any preview), then an unsubscribe arrives.
    Joined = handle_member_add(
        #{<<"thread_id">> => <<"99">>, <<"user_id">> => <<"7">>}, State0
    ),
    Updated = handle_preview_unsubscribe(7, 99, Joined),
    ?assertEqual(true, guild_virtual_channel_access:has_virtual_access(7, 99, Updated)).

handle_member_add_clears_prior_preview_test() ->
    State0 = #{id => 1, sessions => #{}},
    Previewing = handle_preview_subscribe(7, 99, State0),
    ?assertEqual(true, guild_virtual_channel_access:has_thread_preview(7, 99, Previewing)),
    Joined = handle_member_add(
        #{<<"thread_id">> => <<"99">>, <<"user_id">> => <<"7">>}, Previewing
    ),
    ?assertEqual(false, guild_virtual_channel_access:has_thread_preview(7, 99, Joined)),
    %% The preview-turned-member keeps access even if an unsubscribe follows.
    Unsub = handle_preview_unsubscribe(7, 99, Joined),
    ?assertEqual(true, guild_virtual_channel_access:has_virtual_access(7, 99, Unsub)).

-endif.
