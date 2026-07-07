// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import {ChannelTypes, ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import {action, computed, makeObservable, observable} from 'mobx';

const EMPTY_THREADS: ReadonlyArray<Channel> = Object.freeze([]);

/**
 * Tracks which threads are surfaced in the channel sidebar.
 *
 * A thread appears once the user has JOINED it (persisting while the session
 * lives) or while it is being PREVIEWED (a single, ephemeral thread the user has
 * clicked into but not joined — it disappears as soon as they navigate away).
 * The thread channels themselves live in the Channels store; this store only
 * holds membership/preview state and derives the per-parent ordering.
 */
class Threads {
	private readonly joinedThreadIds = observable.set<string>();
	private previewThreadId: string | null = null;
	private readonly memberListVersions = observable.map<string, number>();

	constructor() {
		makeObservable<Threads, 'joinedThreadIds' | 'previewThreadId' | 'memberListVersions'>(this, {
			joinedThreadIds: observable,
			previewThreadId: observable,
			memberListVersions: observable,
			join: action,
			leave: action,
			setJoinedThreads: action,
			setPreview: action,
			bumpMemberListVersion: action,
			clear: action,
			activeThreadIds: computed,
		});
	}

	/**
	 * Replaces the set of joined threads wholesale. Used to restore membership
	 * from the server on (re)connect so joined threads survive an app refresh.
	 */
	@action
	setJoinedThreads(threadIds: Iterable<string>): void {
		this.joinedThreadIds.clear();
		for (const threadId of threadIds) {
			this.joinedThreadIds.add(threadId);
		}
	}

	/**
	 * Monotonic counter bumped whenever a thread's membership changes for any
	 * user, so an open thread member list can refetch itself when someone joins
	 * or leaves (thread membership isn't otherwise mirrored on the client).
	 */
	getMemberListVersion(threadId: string): number {
		return this.memberListVersions.get(threadId) ?? 0;
	}

	@action
	bumpMemberListVersion(threadId: string): void {
		this.memberListVersions.set(threadId, this.getMemberListVersion(threadId) + 1);
	}

	get activeThreadIds(): ReadonlyArray<string> {
		const ids = new Set(this.joinedThreadIds);
		if (this.previewThreadId != null) {
			ids.add(this.previewThreadId);
		}
		return Array.from(ids);
	}

	isJoined(threadId: string): boolean {
		return this.joinedThreadIds.has(threadId);
	}

	isPreviewing(threadId: string): boolean {
		return this.previewThreadId === threadId;
	}

	isActive(threadId: string): boolean {
		return this.isJoined(threadId) || this.isPreviewing(threadId);
	}

	/**
	 * Threads to render nested under a parent channel, in creation order. A
	 * joined thread stays here until it is left, deleted, or closed/archived; the
	 * single previewed thread is always shown while it is the active view.
	 */
	getSidebarThreads(parentChannelId: string): ReadonlyArray<Channel> {
		const threads: Array<Channel> = [];
		for (const threadId of this.activeThreadIds) {
			const channel = Channels.getChannel(threadId);
			if (!channel || channel.type !== ChannelTypes.GUILD_THREAD || (channel.parentId ?? null) !== parentChannelId) {
				continue;
			}
			const isOpen = (channel.threadMetadata?.state ?? ThreadStates.OPEN) === ThreadStates.OPEN;
			if (this.isPreviewing(threadId) || (this.isJoined(threadId) && isOpen)) {
				threads.push(channel);
			}
		}
		threads.sort((a, b) => compareThreadIds(a.id, b.id));
		return threads.length > 0 ? threads : EMPTY_THREADS;
	}

	@action
	join(threadId: string): void {
		this.joinedThreadIds.add(threadId);
	}

	@action
	leave(threadId: string): void {
		this.joinedThreadIds.delete(threadId);
		if (this.previewThreadId === threadId) {
			this.previewThreadId = null;
		}
	}

	/**
	 * Marks the single thread currently being previewed. Pass the thread id when
	 * navigating into a thread the user has not joined, or null when navigating
	 * away; joined threads are never treated as previews.
	 */
	@action
	setPreview(threadId: string | null): void {
		if (threadId != null && this.joinedThreadIds.has(threadId)) {
			this.previewThreadId = null;
			return;
		}
		this.previewThreadId = threadId;
	}

	@action
	clear(): void {
		this.joinedThreadIds.clear();
		this.previewThreadId = null;
		this.memberListVersions.clear();
	}
}

function compareThreadIds(a: string, b: string): number {
	if (a.length !== b.length) {
		return a.length - b.length;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

export default new Threads();
