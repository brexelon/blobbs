// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Permission from '@app/features/permissions/state/Permission';
import {ChannelTypes, Permissions, ThreadStates} from '@fluxer/constants/src/ChannelConstants';

/**
 * The banner shown at the top of a thread view.
 *   - 'locked': the thread is open but locked — only moderators may send.
 *   - 'closedLocked': the thread was manually closed (and therefore locked) —
 *      only a moderator can reopen it. An inactivity auto-close leaves the thread
 *      unlocked and shows no banner (the next message reopens it).
 *   - null: no banner (open, or auto-closed/unlocked).
 */
export type ThreadBannerKind = 'locked' | 'closedLocked' | null;

export function getThreadBannerKind(channel: Channel): ThreadBannerKind {
	if (channel.type !== ChannelTypes.GUILD_THREAD) {
		return null;
	}
	const meta = channel.threadMetadata;
	if (!meta?.locked) {
		return null;
	}
	return meta.state === ThreadStates.CLOSED ? 'closedLocked' : 'locked';
}

/** Whether the current user can manage (edit/lock/close/delete) this thread. */
export function canManageThread(channel: Channel): boolean {
	const parentChannelId = channel.parentId ?? channel.id;
	return Permission.can(Permissions.MANAGE_THREADS, {
		channelId: parentChannelId,
		guildId: channel.guildId ?? undefined,
	});
}

/**
 * Whether sending is blocked for the current user because the thread is locked.
 * Locking only restricts non-managers; members with Manage Threads may still send.
 */
export function isThreadSendLocked(channel: Channel): boolean {
	if (channel.type !== ChannelTypes.GUILD_THREAD) {
		return false;
	}
	return (channel.threadMetadata?.locked ?? false) && !canManageThread(channel);
}
