// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
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

	constructor() {
		makeObservable<Threads, 'joinedThreadIds' | 'previewThreadId'>(this, {
			joinedThreadIds: observable,
			previewThreadId: observable,
			join: action,
			leave: action,
			setPreview: action,
			clear: action,
			activeThreadIds: computed,
		});
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

	/** Threads to render nested under a parent channel, in creation order. */
	getSidebarThreads(parentChannelId: string): ReadonlyArray<Channel> {
		const threads: Array<Channel> = [];
		for (const threadId of this.activeThreadIds) {
			const channel = Channels.getChannel(threadId);
			if (channel && channel.type === ChannelTypes.GUILD_THREAD && (channel.parentId ?? null) === parentChannelId) {
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
	}
}

function compareThreadIds(a: string, b: string): number {
	if (a.length !== b.length) {
		return a.length - b.length;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

export default new Threads();
