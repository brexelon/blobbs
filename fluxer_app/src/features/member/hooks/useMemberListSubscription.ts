// SPDX-License-Identifier: AGPL-3.0-or-later

import GatewayConnection from '@app/features/gateway/transport/GatewayConnection';
import {
	createMemberListSubscriptionSnapshot,
	INITIAL_MEMBER_LIST_SUBSCRIPTION_RANGE,
	type MemberListRanges,
	type MemberListSubscriptionMachineEvent,
	selectMemberListSubscriptionModel,
	transitionMemberListSubscriptionSnapshot,
} from '@app/features/member/state/MemberListSubscriptionStateMachine';
import MemberSidebar from '@app/features/member/state/MemberSidebar';
import {
	areNormalizedMemberListRangesCovered,
	normalizeMemberListRanges,
} from '@app/features/member/utils/MemberListRangeUtils';
import Window from '@app/features/window/state/Window';
import {reaction} from 'mobx';
import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';

interface UseMemberListSubscriptionOptions {
	guildId: string;
	channelId: string;
	enabled: boolean;
}

interface UseMemberListSubscriptionResult {
	subscribe: (ranges: Array<[number, number]>) => void;
	forceSubscribe: (ranges: Array<[number, number]>) => void;
	unsubscribe: () => void;
	resubscribe: () => void;
	isPaused: boolean;
}

function subscribeToWindowActive(onChange: () => void): () => void {
	return reaction(
		() => Window.visible,
		() => onChange(),
	);
}

function getWindowActiveSnapshot(): boolean {
	return Window.visible;
}

let nextMemberListSubscriptionOwnerId = 0;

function createMemberListSubscriptionOwnerId(): string {
	nextMemberListSubscriptionOwnerId += 1;
	return `member-list-subscription:${nextMemberListSubscriptionOwnerId}`;
}

export function useMemberListSubscription({
	guildId,
	channelId,
	enabled,
}: UseMemberListSubscriptionOptions): UseMemberListSubscriptionResult {
	const isWindowActive = useSyncExternalStore(subscribeToWindowActive, getWindowActiveSnapshot, getWindowActiveSnapshot);
	const isPaused = enabled && !isWindowActive;
	const subscriptionSnapshotRef = useRef(
		createMemberListSubscriptionSnapshot({
			enabled,
			paused: enabled && !Window.visible,
			desiredRanges: [INITIAL_MEMBER_LIST_SUBSCRIPTION_RANGE],
		}),
	);
	const lastSessionVersionRef = useRef(MemberSidebar.sessionVersion);
	const lastGatewayReadyRef = useRef(GatewayConnection.isReady);
	const hadChannelListRef = useRef(MemberSidebar.getList(guildId, channelId) !== undefined);
	const retryTimerRef = useRef<number | null>(null);
	const resyncBaselineVersionRef = useRef<number | null>(null);
	const retryResumeGenerationRef = useRef(GatewayConnection.resumeGeneration);
	const retrySessionVersionRef = useRef(MemberSidebar.sessionVersion);
	const retryGatewayReadyRef = useRef(GatewayConnection.isReady);
	const pendingResumeWhilePausedRef = useRef(false);
	const ownerIdRef = useRef(createMemberListSubscriptionOwnerId());
	const ownerId = ownerIdRef.current;
	const readSubscriptionModel = useCallback(
		() => selectMemberListSubscriptionModel(subscriptionSnapshotRef.current),
		[],
	);
	const sendSubscriptionEvent = useCallback((event: MemberListSubscriptionMachineEvent) => {
		subscriptionSnapshotRef.current = transitionMemberListSubscriptionSnapshot(subscriptionSnapshotRef.current, event);
		return selectMemberListSubscriptionModel(subscriptionSnapshotRef.current);
	}, []);
	const clearRetryTimer = useCallback(() => {
		if (retryTimerRef.current != null) {
			window.clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}, []);
	const isMemberListFresh = useCallback(() => {
		const baseline = resyncBaselineVersionRef.current;
		const {desiredRanges} = readSubscriptionModel();
		if (baseline != null && MemberSidebar.getListUpdateVersion(guildId, channelId) <= baseline) {
			return false;
		}
		return MemberSidebar.areItemsLoadedForRanges(guildId, channelId, desiredRanges);
	}, [guildId, channelId, readSubscriptionModel]);
	const attemptSubscribe = useCallback(
		(ranges: MemberListRanges, forceSubscriptionUpdate = false) => {
			const normalizedRanges = normalizeMemberListRanges(ranges);
			const subscriptionModel = readSubscriptionModel();
			if (!enabled || !subscriptionModel.isActive) {
				return;
			}
			if (!MemberSidebar.isActiveMemberListSubscriptionOwner(guildId, channelId, ownerId)) {
				return;
			}
			const currentSubscribedRanges = MemberSidebar.getSubscribedRanges(guildId, channelId);
			const localStoreCoversDesiredRange = areNormalizedMemberListRangesCovered(
				normalizedRanges,
				currentSubscribedRanges,
			);
			const lastSubscriptionCoversDesiredRange = areNormalizedMemberListRangesCovered(
				normalizedRanges,
				subscriptionModel.subscribedRanges,
			);
			if (
				!forceSubscriptionUpdate &&
				subscriptionModel.isSubscribed &&
				localStoreCoversDesiredRange &&
				lastSubscriptionCoversDesiredRange
			) {
				return;
			}
			MemberSidebar.subscribeToChannel(guildId, channelId, normalizedRanges, forceSubscriptionUpdate, ownerId);
			if (forceSubscriptionUpdate) {
				// A forced (re)subscribe must be confirmed by a fresh SYNC. Capture the
				// current update version as a baseline so cached members don't make the
				// retry loop conclude the subscription succeeded.
				resyncBaselineVersionRef.current = MemberSidebar.getListUpdateVersion(guildId, channelId);
			}
			sendSubscriptionEvent({
				type: 'memberListSubscription.subscriptionApplied',
				ranges: normalizedRanges,
			});
		},
		[guildId, channelId, enabled, ownerId, readSubscriptionModel, sendSubscriptionEvent],
	);
	const flushPendingSubscribe = useCallback(() => {
		const {isActive, pendingRanges} = readSubscriptionModel();
		if (!isActive) {
			return;
		}
		if (!pendingRanges) {
			return;
		}
		sendSubscriptionEvent({type: 'memberListSubscription.pendingFlushed'});
		attemptSubscribe(pendingRanges);
	}, [attemptSubscribe, readSubscriptionModel, sendSubscriptionEvent]);
	const queueSubscribe = useCallback(
		(ranges: MemberListRanges) => {
			const normalizedRanges = normalizeMemberListRanges(ranges);
			const model = sendSubscriptionEvent({
				type: 'memberListSubscription.rangesRequested',
				ranges: normalizedRanges,
			});
			if (!model.isActive) {
				return;
			}
			flushPendingSubscribe();
		},
		[flushPendingSubscribe, sendSubscriptionEvent],
	);
	const subscribe = useCallback(
		(ranges: MemberListRanges) => {
			queueSubscribe(ranges);
		},
		[queueSubscribe],
	);
	const forceSubscribe = useCallback(
		(ranges: MemberListRanges) => {
			const normalizedRanges = normalizeMemberListRanges(ranges);
			sendSubscriptionEvent({
				type: 'memberListSubscription.rangesRequested',
				ranges: normalizedRanges,
			});
			attemptSubscribe(normalizedRanges, true);
		},
		[attemptSubscribe, sendSubscriptionEvent],
	);
	const clearSubscription = useCallback(
		(updateGateway: boolean) => {
			clearRetryTimer();
			resyncBaselineVersionRef.current = null;
			const wasSubscribed = readSubscriptionModel().isSubscribed;
			const ownsSubscription = MemberSidebar.isActiveMemberListSubscriptionOwner(guildId, channelId, ownerId);
			const hasLocalSubscription = ownsSubscription && MemberSidebar.getSubscribedRanges(guildId, channelId).length > 0;
			sendSubscriptionEvent({type: 'memberListSubscription.subscriptionCleared'});
			if (wasSubscribed || hasLocalSubscription) {
				if (updateGateway) {
					MemberSidebar.unsubscribeFromChannel(guildId, channelId, true, ownerId);
				} else {
					MemberSidebar.releaseMemberListSubscription(guildId, channelId, ownerId);
				}
			}
		},
		[guildId, channelId, ownerId, clearRetryTimer, readSubscriptionModel, sendSubscriptionEvent],
	);
	const unsubscribe = useCallback(() => {
		clearSubscription(true);
	}, [clearSubscription]);
	const pauseSubscription = useCallback(() => {
		clearRetryTimer();
		resyncBaselineVersionRef.current = null;
		const model = readSubscriptionModel();
		const ownsSubscription = MemberSidebar.isActiveMemberListSubscriptionOwner(guildId, channelId, ownerId);
		const hasLocalSubscription = ownsSubscription && MemberSidebar.getSubscribedRanges(guildId, channelId).length > 0;
		sendSubscriptionEvent({type: 'memberListSubscription.paused'});
		if (model.isSubscribed || hasLocalSubscription) {
			MemberSidebar.releaseMemberListSubscription(guildId, channelId, ownerId, true, true);
		}
	}, [guildId, channelId, ownerId, clearRetryTimer, readSubscriptionModel, sendSubscriptionEvent]);
	const resubscribe = useCallback(() => {
		const {desiredRanges} = readSubscriptionModel();
		if (desiredRanges.length > 0) {
			attemptSubscribe(desiredRanges, true);
		}
	}, [attemptSubscribe, readSubscriptionModel]);
	useEffect(() => {
		sendSubscriptionEvent({
			type: 'memberListSubscription.reset',
			desiredRanges: [INITIAL_MEMBER_LIST_SUBSCRIPTION_RANGE],
		});
		lastSessionVersionRef.current = MemberSidebar.sessionVersion;
		lastGatewayReadyRef.current = GatewayConnection.isReady;
		hadChannelListRef.current = MemberSidebar.getList(guildId, channelId) !== undefined;
		resyncBaselineVersionRef.current = null;
		retryResumeGenerationRef.current = GatewayConnection.resumeGeneration;
		retrySessionVersionRef.current = MemberSidebar.sessionVersion;
		retryGatewayReadyRef.current = GatewayConnection.isReady;
		pendingResumeWhilePausedRef.current = false;
		clearRetryTimer();
	}, [guildId, channelId, clearRetryTimer, sendSubscriptionEvent]);
	useEffect(() => {
		if (!enabled) {
			unsubscribe();
			sendSubscriptionEvent({type: 'memberListSubscription.disabled'});
			return;
		}
		sendSubscriptionEvent({type: 'memberListSubscription.enabled'});
		const disposeSessionReaction = reaction(
			() => MemberSidebar.sessionVersion,
			(newVersion) => {
				if (newVersion !== lastSessionVersionRef.current) {
					lastSessionVersionRef.current = newVersion;
					sendSubscriptionEvent({type: 'memberListSubscription.subscriptionCleared'});
					if (readSubscriptionModel().isActive) {
						MemberSidebar.claimMemberListSubscription(guildId, channelId, ownerId);
						resubscribe();
					}
				}
			},
		);
		const disposeGatewayReadyReaction = reaction(
			() => GatewayConnection.isReady,
			(isReady) => {
				const wasReady = lastGatewayReadyRef.current;
				lastGatewayReadyRef.current = isReady;
				if (!enabled) {
					return;
				}
				if (isReady && !wasReady && readSubscriptionModel().isActive) {
					MemberSidebar.claimMemberListSubscription(guildId, channelId, ownerId);
					attemptSubscribe(readSubscriptionModel().desiredRanges, true);
				}
			},
		);
		const disposeGuildListReaction = reaction(
			() => MemberSidebar.getList(guildId, channelId) !== undefined,
			(hasChannelList) => {
				const hadChannelList = hadChannelListRef.current;
				hadChannelListRef.current = hasChannelList;
				if (hadChannelList && !hasChannelList) {
					sendSubscriptionEvent({type: 'memberListSubscription.subscriptionCleared'});
				}
				if (!hasChannelList && enabled && readSubscriptionModel().isActive) {
					MemberSidebar.claimMemberListSubscription(guildId, channelId, ownerId);
					resubscribe();
				}
			},
		);
		const disposeResumeReaction = reaction(
			() => GatewayConnection.resumeGeneration,
			() => {
				if (!enabled) {
					return;
				}
				if (!readSubscriptionModel().isActive) {
					pendingResumeWhilePausedRef.current = true;
					return;
				}
				sendSubscriptionEvent({type: 'memberListSubscription.subscriptionCleared'});
				MemberSidebar.claimMemberListSubscription(guildId, channelId, ownerId);
				resubscribe();
			},
		);
		return () => {
			disposeSessionReaction();
			disposeGatewayReadyReaction();
			disposeGuildListReaction();
			disposeResumeReaction();
		};
	}, [
		guildId,
		channelId,
		enabled,
		resubscribe,
		unsubscribe,
		attemptSubscribe,
		ownerId,
		readSubscriptionModel,
		sendSubscriptionEvent,
	]);
	useEffect(() => {
		return () => {
			// Tell the gateway to drop the subscription when the visible member list
			// unmounts. A local-only release leaves the server thinking we're still
			// subscribed, so returning to the same channel won't trigger a fresh SYNC.
			unsubscribe();
		};
	}, [guildId, channelId, unsubscribe]);
	useEffect(() => {
		if (!enabled) {
			return;
		}
		if (isWindowActive) {
			MemberSidebar.flushPendingListUpdates();
			MemberSidebar.claimMemberListSubscription(guildId, channelId, ownerId);
			sendSubscriptionEvent({type: 'memberListSubscription.resumed'});
			if (pendingResumeWhilePausedRef.current) {
				pendingResumeWhilePausedRef.current = false;
				sendSubscriptionEvent({type: 'memberListSubscription.subscriptionCleared'});
			}
			sendSubscriptionEvent({
				type: 'memberListSubscription.rangesRequested',
				ranges: [INITIAL_MEMBER_LIST_SUBSCRIPTION_RANGE],
			});
			resubscribe();
			return;
		}
		pauseSubscription();
	}, [guildId, channelId, enabled, isWindowActive, ownerId, pauseSubscription, resubscribe, sendSubscriptionEvent]);
	useEffect(() => {
		if (!enabled || !isWindowActive) {
			return;
		}
		const scheduleRetry = () => {
			clearRetryTimer();
			const {retryDelayMs} = readSubscriptionModel();
			retryTimerRef.current = window.setTimeout(() => {
				retryTimerRef.current = null;
				if (!readSubscriptionModel().isActive) {
					return;
				}
				if (!MemberSidebar.isActiveMemberListSubscriptionOwner(guildId, channelId, ownerId)) {
					return;
				}
				if (isMemberListFresh()) {
					resyncBaselineVersionRef.current = null;
					sendSubscriptionEvent({type: 'memberListSubscription.retrySucceeded'});
					return;
				}
				attemptSubscribe(readSubscriptionModel().desiredRanges, true);
				sendSubscriptionEvent({type: 'memberListSubscription.retryBackedOff'});
				scheduleRetry();
			}, retryDelayMs);
		};
		const invalidateOnResync = () => {
			// A resume/reconnect/session change can silently drop the previous
			// member-list subscription. Treat the cached list as unconfirmed so the
			// retry loop re-verifies it via a fresh SYNC instead of trusting stale
			// members that are still in the cache.
			const resumeGeneration = GatewayConnection.resumeGeneration;
			const sessionVersion = MemberSidebar.sessionVersion;
			const isReady = GatewayConnection.isReady;
			const readyRose = isReady && !retryGatewayReadyRef.current;
			const resynced =
				resumeGeneration !== retryResumeGenerationRef.current ||
				sessionVersion !== retrySessionVersionRef.current ||
				readyRose;
			retryResumeGenerationRef.current = resumeGeneration;
			retrySessionVersionRef.current = sessionVersion;
			retryGatewayReadyRef.current = isReady;
			if (resynced) {
				resyncBaselineVersionRef.current = MemberSidebar.getListUpdateVersion(guildId, channelId);
			}
		};
		const disposeRetryReaction = reaction(
			() => {
				const list = MemberSidebar.getList(guildId, channelId);
				const itemCount = list != null ? list.items.size : 0;
				const updateVersion = MemberSidebar.getListUpdateVersion(guildId, channelId);
				const resumeGeneration = GatewayConnection.resumeGeneration;
				const sessionVersion = MemberSidebar.sessionVersion;
				const isReady = GatewayConnection.isReady ? 1 : 0;
				return `${itemCount}:${updateVersion}:${resumeGeneration}:${sessionVersion}:${isReady}`;
			},
			() => {
				invalidateOnResync();
				if (isMemberListFresh()) {
					clearRetryTimer();
					resyncBaselineVersionRef.current = null;
					sendSubscriptionEvent({type: 'memberListSubscription.retrySucceeded'});
				} else if (MemberSidebar.isActiveMemberListSubscriptionOwner(guildId, channelId, ownerId)) {
					scheduleRetry();
				} else {
					clearRetryTimer();
				}
			},
			{fireImmediately: true},
		);
		return () => {
			disposeRetryReaction();
			clearRetryTimer();
		};
	}, [
		guildId,
		channelId,
		enabled,
		isWindowActive,
		attemptSubscribe,
		clearRetryTimer,
		isMemberListFresh,
		ownerId,
		readSubscriptionModel,
		sendSubscriptionEvent,
	]);
	useEffect(() => {
		const {isActive, isSubscribed, desiredRanges} = readSubscriptionModel();
		if (
			enabled &&
			isWindowActive &&
			isActive &&
			!isSubscribed &&
			MemberSidebar.isActiveMemberListSubscriptionOwner(guildId, channelId, ownerId)
		) {
			queueSubscribe(desiredRanges);
		}
	}, [guildId, channelId, enabled, isWindowActive, ownerId, queueSubscribe, readSubscriptionModel]);
	return {subscribe, forceSubscribe, unsubscribe, resubscribe, isPaused};
}
