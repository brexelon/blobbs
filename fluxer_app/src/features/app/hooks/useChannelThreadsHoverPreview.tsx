// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import {
	ChannelThreadsPreviewPopout,
	selectPreviewThreads,
} from '@app/features/channel/components/popouts/ChannelThreadsPreviewPopout';
import type {Channel} from '@app/features/channel/models/Channel';
import type {Guild} from '@app/features/guild/models/Guild';
import * as PopoutCommands from '@app/features/ui/commands/PopoutCommands';
import {openPopout} from '@app/features/ui/popover/PopoverPopout';
import {canUseWindowFocusedHoverControls} from '@app/features/ui/utils/WindowFocusInteractionGuard';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {useCallback, useEffect, useMemo, useRef} from 'react';

// Wait before opening so brushing past a channel does not flash the popout, and
// keep it briefly alive after leaving so the pointer can travel into it.
const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 200;
// The thread list is fetched lazily on hover; reuse a recent fetch rather than
// re-hitting the API each time the pointer re-enters the same channel.
const REFRESH_TTL_MS = 10_000;

interface UseChannelThreadsHoverPreviewParams {
	guild: Guild;
	channel: Channel;
	anchorRef: React.RefObject<HTMLElement | null>;
	enabled: boolean;
}

/**
 * Wires a channel row to a Discord-style "More Active Threads" hover popout: on
 * hover it lazily fetches the channel's threads, and if any are closed (but not
 * locked) it opens a small preview of the most recently active few anchored to
 * the row. The popout is only opened when such threads exist, so channels
 * without closed threads show nothing.
 */
export function useChannelThreadsHoverPreview({
	guild,
	channel,
	anchorRef,
	enabled,
}: UseChannelThreadsHoverPreviewParams): {
	onTriggerEnter: () => void;
	onTriggerLeave: () => void;
} {
	const popoutKey = useMemo(() => `channel-threads-preview:${channel.id}`, [channel.id]);
	const isTriggerHoveringRef = useRef(false);
	const isContentHoveringRef = useRef(false);
	const isOpenRef = useRef(false);
	const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const previewThreadsRef = useRef<ReadonlyArray<WireChannel>>([]);
	const lastFetchAtRef = useRef(0);
	const fetchPromiseRef = useRef<Promise<void> | null>(null);

	const clearOpenTimer = useCallback(() => {
		if (openTimerRef.current) {
			clearTimeout(openTimerRef.current);
			openTimerRef.current = null;
		}
	}, []);
	const clearCloseTimer = useCallback(() => {
		if (closeTimerRef.current) {
			clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);

	const ensureThreads = useCallback(() => {
		if (fetchPromiseRef.current) {
			return fetchPromiseRef.current;
		}
		if (lastFetchAtRef.current !== 0 && Date.now() - lastFetchAtRef.current < REFRESH_TTL_MS) {
			return Promise.resolve();
		}
		const promise = ThreadCommands.listThreads(channel.id)
			.then((threads) => {
				previewThreadsRef.current = selectPreviewThreads(threads);
				lastFetchAtRef.current = Date.now();
			})
			.catch(() => {
				// Best effort: a failed fetch just means no preview this pass.
			})
			.finally(() => {
				fetchPromiseRef.current = null;
			});
		fetchPromiseRef.current = promise;
		return promise;
	}, [channel.id]);

	const close = useCallback(() => {
		if (!isOpenRef.current) {
			return;
		}
		isOpenRef.current = false;
		PopoutCommands.close(popoutKey);
	}, [popoutKey]);

	const scheduleClose = useCallback(() => {
		clearCloseTimer();
		closeTimerRef.current = setTimeout(() => {
			if (!isTriggerHoveringRef.current && !isContentHoveringRef.current) {
				close();
			}
		}, HOVER_CLOSE_DELAY_MS);
	}, [clearCloseTimer, close]);

	const doOpen = useCallback(() => {
		const anchor = anchorRef.current;
		if (!anchor || isOpenRef.current) {
			return;
		}
		if (previewThreadsRef.current.length === 0) {
			return;
		}
		if (!canUseWindowFocusedHoverControls(anchor.ownerDocument.documentElement)) {
			return;
		}
		isOpenRef.current = true;
		openPopout(
			anchor,
			{
				position: 'right-start',
				offsetMainAxis: 12,
				animationType: 'smooth',
				disableBackdrop: true,
				hoverMode: true,
				onContentMouseEnter: () => {
					isContentHoveringRef.current = true;
					clearCloseTimer();
				},
				onContentMouseLeave: () => {
					isContentHoveringRef.current = false;
					scheduleClose();
				},
				render: ({onClose}) => (
					<ChannelThreadsPreviewPopout
						guild={guild}
						channel={channel}
						threads={previewThreadsRef.current}
						getAnchor={() => anchorRef.current}
						onClose={() => {
							isOpenRef.current = false;
							onClose();
						}}
						data-flx="app.use-channel-threads-hover-preview.channel-threads-preview-popout"
					/>
				),
			},
			popoutKey,
		);
	}, [anchorRef, channel, guild, popoutKey, clearCloseTimer, scheduleClose]);

	const onTriggerEnter = useCallback(() => {
		if (!enabled) {
			return;
		}
		isTriggerHoveringRef.current = true;
		clearCloseTimer();
		void ensureThreads();
		clearOpenTimer();
		openTimerRef.current = setTimeout(() => {
			void ensureThreads().then(() => {
				if (isTriggerHoveringRef.current) {
					doOpen();
				}
			});
		}, HOVER_OPEN_DELAY_MS);
	}, [enabled, clearCloseTimer, clearOpenTimer, ensureThreads, doOpen]);

	const onTriggerLeave = useCallback(() => {
		isTriggerHoveringRef.current = false;
		clearOpenTimer();
		scheduleClose();
	}, [clearOpenTimer, scheduleClose]);

	useEffect(() => {
		return () => {
			clearOpenTimer();
			clearCloseTimer();
			if (isOpenRef.current) {
				isOpenRef.current = false;
				PopoutCommands.close(popoutKey);
			}
		};
	}, [clearOpenTimer, clearCloseTimer, popoutKey]);

	return {onTriggerEnter, onTriggerLeave};
}
