// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

type ThreadSidebarMode = 'closed' | 'view' | 'create';

/**
 * Tracks the state of the right-hand thread panel that sits beside a channel.
 *
 * The panel has two modes:
 *  - `view`: a single thread is shown inline (read-along-and-reply), opened by
 *    clicking a thread preview card under a message.
 *  - `create`: a Discord-style "New Thread" form is shown for the parent channel,
 *    optionally rooted on an existing message. Submitting it transitions the panel
 *    straight into `view` for the freshly created thread.
 *
 * Clicking a thread from the left channel list still opens it in full view via
 * normal navigation, so this store is intentionally independent of the
 * {@link Threads} joined/preview state used by that list.
 */
class ThreadSidebar {
	mode: ThreadSidebarMode = 'closed';
	/** The thread currently shown in the panel (view mode), or null. */
	openThreadId: string | null = null;
	/** The parent channel the panel belongs to; the panel only renders there. */
	parentChannelId: string | null = null;
	/** Guild of the parent channel while creating a thread. */
	createGuildId: string | null = null;
	/** Origin message the new thread is rooted on, or null for a standalone thread. */
	createOriginMessageId: string | null = null;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	isOpenForThread(threadId: string): boolean {
		return this.mode === 'view' && this.openThreadId === threadId;
	}

	isCreatingForParent(parentChannelId: string): boolean {
		return this.mode === 'create' && this.parentChannelId === parentChannelId;
	}

	open(threadId: string, parentChannelId: string): void {
		this.mode = 'view';
		this.openThreadId = threadId;
		this.parentChannelId = parentChannelId;
		this.createGuildId = null;
		this.createOriginMessageId = null;
	}

	toggle(threadId: string, parentChannelId: string): void {
		if (this.mode === 'view' && this.openThreadId === threadId) {
			this.close();
			return;
		}
		this.open(threadId, parentChannelId);
	}

	openCreate(params: {parentChannelId: string; guildId: string; originMessageId?: string | null}): void {
		this.mode = 'create';
		this.openThreadId = null;
		this.parentChannelId = params.parentChannelId;
		this.createGuildId = params.guildId;
		this.createOriginMessageId = params.originMessageId ?? null;
	}

	close(): void {
		this.mode = 'closed';
		this.openThreadId = null;
		this.parentChannelId = null;
		this.createGuildId = null;
		this.createOriginMessageId = null;
	}

	/** Closes the panel unless it belongs to the given parent channel. */
	closeIfNotParent(parentChannelId: string | null | undefined): void {
		if (this.mode !== 'closed' && this.parentChannelId !== parentChannelId) {
			this.close();
		}
	}
}

export default new ThreadSidebar();
