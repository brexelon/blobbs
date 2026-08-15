%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(presence_broadcast_subscriptions_tests).
-typing([eqwalizer]).

-include_lib("eunit/include/eunit.hrl").

gdm_subscription_add_remove_test() ->
    maybe_start_presence_bus(),
    maybe_start_presence_cache(),
    BaseState = #{
        user_id => 1,
        is_bot => false,
        sessions => #{},
        user_data => #{},
        subscriptions => #{},
        friends => #{},
        group_dm_recipients => #{}
    },
    State1 = presence_broadcast_subscriptions:sync_group_dm_subscriptions(
        #{1 => [10]}, BaseState
    ),
    Subscriptions1 = maps:get(subscriptions, State1),
    Entry1 = maps:get(10, Subscriptions1),
    ?assertEqual(true, maps:get(1, maps:get(gdm_channels, Entry1, #{}))),
    State2 = presence_broadcast_subscriptions:sync_group_dm_subscriptions(#{}, State1),
    ?assertEqual(false, maps:is_key(10, maps:get(subscriptions, State2, #{}))).

only_group_dm_recipients_get_global_subscriptions_test() ->
    maybe_start_presence_bus(),
    maybe_start_presence_cache(),
    SessionState = #{
        user_id => 1,
        channels => #{
            100 => #{
                <<"id">> => <<"100">>,
                <<"type">> => 1,
                <<"recipients">> => [#{<<"id">> => <<"2">>, <<"username">> => <<"dm-user">>}]
            },
            200 => #{
                <<"id">> => <<"200">>,
                <<"type">> => 3,
                <<"recipients">> => [
                    #{<<"id">> => <<"3">>, <<"username">> => <<"gdm-a">>},
                    #{<<"id">> => <<"4">>, <<"username">> => <<"gdm-b">>}
                ]
            }
        }
    },
    GroupDmRecipients = presence_targets:group_dm_recipients_from_state(SessionState),
    BaseState = #{
        user_id => 1,
        is_bot => false,
        sessions => #{},
        user_data => #{},
        subscriptions => #{},
        friends => #{},
        group_dm_recipients => #{}
    },
    State1 = presence_broadcast_subscriptions:sync_group_dm_subscriptions(
        GroupDmRecipients, BaseState
    ),
    Subscriptions = maps:get(subscriptions, State1),
    ?assertEqual(false, maps:is_key(2, Subscriptions)),
    ?assertEqual(true, maps:get(200, maps:get(gdm_channels, maps:get(3, Subscriptions)))),
    ?assertEqual(true, maps:get(200, maps:get(gdm_channels, maps:get(4, Subscriptions)))),
    StateAfterGroupDmClose = presence_broadcast_subscriptions:sync_group_dm_subscriptions(
        maps:remove(200, GroupDmRecipients), State1
    ),
    SubsAfterClose = maps:get(subscriptions, StateAfterGroupDmClose),
    ?assertEqual(false, maps:is_key(2, SubsAfterClose)),
    ?assertEqual(false, maps:is_key(3, SubsAfterClose)),
    ?assertEqual(false, maps:is_key(4, SubsAfterClose)).

one_to_one_dm_does_not_create_global_subscription_test() ->
    maybe_start_presence_bus(),
    SessionState = #{
        user_id => 1,
        channels => #{
            100 => #{
                <<"id">> => <<"100">>,
                <<"type">> => 1,
                <<"recipients">> => [#{<<"id">> => <<"2">>, <<"username">> => <<"dm-user">>}]
            }
        }
    },
    State = #{
        user_id => 1,
        is_bot => false,
        sessions => #{},
        user_data => #{},
        subscriptions => #{},
        friends => #{},
        group_dm_recipients => presence_targets:group_dm_recipients_from_state(SessionState)
    },
    State1 = presence_broadcast_subscriptions:ensure_initial_global_subscriptions(State),
    Subscriptions = maps:get(subscriptions, State1),
    ?assertEqual(#{}, Subscriptions).

map_from_ids_test() ->
    ?assertEqual(#{}, presence_broadcast_subscriptions:map_from_ids([])),
    ?assertEqual(
        #{1 => true, 2 => true}, presence_broadcast_subscriptions:map_from_ids([1, 2])
    ).

%% Accepting a friend request adds a friend with nothing buffered for them, so their
%% cached presence is the only thing that tells the client they are online. Without it
%% the friend rendered as offline until the next identify.
new_friend_receives_cached_presence_test() ->
    maybe_start_presence_bus(),
    maybe_start_presence_cache(),
    seed_visible_presence(2),
    drain_mailbox(),
    State = friend_sync_base_state(),
    _ = presence_broadcast_subscriptions:sync_friend_subscriptions([2], [], State),
    ?assertEqual({ok, <<"online">>}, await_presence_status(2)).

%% The counterpart: an id reported as flushed already had its presence delivered from the
%% pending buffer, so the cached copy is deliberately not sent again.
flushed_friend_does_not_receive_cached_presence_test() ->
    maybe_start_presence_bus(),
    maybe_start_presence_cache(),
    seed_visible_presence(3),
    drain_mailbox(),
    State = friend_sync_base_state(),
    _ = presence_broadcast_subscriptions:sync_friend_subscriptions([3], [3], State),
    ?assertEqual(timeout, await_presence_status(3)).

%% The cache write is asynchronous, so wait for it to be readable before relying on it.
seed_visible_presence(UserId) ->
    presence_cache:put(UserId, online_presence(UserId)),
    ?assertEqual(ok, wait_for_visible_presence(UserId, 100)).

wait_for_visible_presence(_UserId, 0) ->
    timeout;
wait_for_visible_presence(UserId, Attempts) ->
    case presence_cache_safe:get_visible(UserId) of
        {ok, _} ->
            ok;
        not_found ->
            timer:sleep(10),
            wait_for_visible_presence(UserId, Attempts - 1)
    end.

friend_sync_base_state() ->
    #{
        user_id => 1,
        is_bot => false,
        sessions => #{<<"s1">> => #{pid => self()}},
        user_data => #{},
        subscriptions => #{},
        friends => #{},
        group_dm_recipients => #{}
    }.

online_presence(UserId) ->
    #{
        <<"user">> => #{<<"id">> => integer_to_binary(UserId)},
        <<"status">> => <<"online">>,
        <<"mobile">> => false,
        <<"afk">> => false,
        <<"custom_status">> => null
    }.

await_presence_status(UserId) ->
    Expected = integer_to_binary(UserId),
    receive
        {'$gen_cast', {dispatch, presence_update, #{<<"user">> := #{<<"id">> := Expected}} = P}} ->
            {ok, maps:get(<<"status">>, P, undefined)}
    after 1000 ->
        timeout
    end.

drain_mailbox() ->
    receive
        _ -> drain_mailbox()
    after 0 ->
        ok
    end.

maybe_start_presence_bus() ->
    case whereis(presence_bus) of
        undefined -> start_presence_bus();
        _ -> ok
    end.

start_presence_bus() ->
    case presence_bus:start_link() of
        {ok, _Pid} -> ok;
        {error, {already_started, _Pid}} -> ok;
        Other -> Other
    end.

maybe_start_presence_cache() ->
    case whereis(presence_cache) of
        undefined -> start_presence_cache();
        _ -> ok
    end.

start_presence_cache() ->
    case presence_cache:start_link() of
        {ok, _Pid} -> ok;
        {error, {already_started, _Pid}} -> ok;
        Other -> Other
    end.
