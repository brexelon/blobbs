%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Thread preview subscribe/unsubscribe routing.
%%
%% When a user opens a thread they have not joined, the client sends a
%% subscribe_thread_preview gateway op; leaving the thread view sends
%% unsubscribe_thread_preview. These are ephemeral, view-scoped grants that let
%% the session receive the thread's channel-scoped events (messages, typing)
%% without a persisted thread_members row — the thread vanishes from the sidebar
%% the moment the client navigates away.
%%
%% This module runs on the websocket request-worker (it is handed a snapshot of
%% the session state), validates the payload, locates the guild gen_server the
%% thread belongs to, and casts the grant/revoke to it. The actual virtual
%% access mutation lives in guild_state_thread / guild_virtual_channel_access so
%% that preview grants share the exact visibility machinery joined members use.

-module(guild_thread_preview).
-typing([eqwalizer]).

-export([handle_op/3]).

-type action() :: subscribe | unsubscribe.
-type session_state() :: map().
-export_type([action/0, session_state/0]).

-spec handle_op(action(), term(), session_state()) -> ok.
handle_op(Action, Data, SessionState) when is_map(Data) ->
    GuildIdRaw = maps:get(<<"guild_id">>, Data, undefined),
    ThreadIdRaw = maps:get(<<"thread_id">>, Data, undefined),
    case {validation:validate_snowflake(GuildIdRaw), validation:validate_snowflake(ThreadIdRaw)} of
        {{ok, GuildId}, {ok, ThreadId}} ->
            route(Action, GuildId, ThreadId, SessionState);
        _ ->
            ok
    end;
handle_op(_Action, _Data, _SessionState) ->
    ok.

-spec route(action(), integer(), integer(), session_state()) -> ok.
route(Action, GuildId, ThreadId, SessionState) ->
    UserId = maps:get(user_id, SessionState, undefined),
    Guilds = maps:get(guilds, SessionState, #{}),
    case {is_integer(UserId), maps:find(GuildId, Guilds)} of
        {true, {ok, {GuildPid, _Ref}}} when is_pid(GuildPid) ->
            _ = shard_utils:safe_cast(GuildPid, cast_message(Action, UserId, ThreadId)),
            ok;
        _ ->
            ok
    end.

-spec cast_message(action(), integer(), integer()) -> term().
cast_message(subscribe, UserId, ThreadId) ->
    {thread_preview_subscribe, UserId, ThreadId};
cast_message(unsubscribe, UserId, ThreadId) ->
    {thread_preview_unsubscribe, UserId, ThreadId}.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

cast_message_maps_action_test() ->
    ?assertEqual({thread_preview_subscribe, 7, 99}, cast_message(subscribe, 7, 99)),
    ?assertEqual({thread_preview_unsubscribe, 7, 99}, cast_message(unsubscribe, 7, 99)).

handle_op_ignores_non_map_data_test() ->
    ?assertEqual(ok, handle_op(subscribe, <<"nope">>, #{})).

handle_op_ignores_missing_fields_test() ->
    ?assertEqual(ok, handle_op(subscribe, #{<<"guild_id">> => <<"1">>}, #{user_id => 7, guilds => #{}})),
    ?assertEqual(ok, handle_op(subscribe, #{<<"thread_id">> => <<"99">>}, #{user_id => 7, guilds => #{}})).

handle_op_ignores_unknown_guild_test() ->
    Data = #{<<"guild_id">> => <<"1">>, <<"thread_id">> => <<"99">>},
    ?assertEqual(ok, handle_op(subscribe, Data, #{user_id => 7, guilds => #{}})).

-endif.
