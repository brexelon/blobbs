// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

/**
 * Tracks the single thread that is currently being previewed in the right-hand
 * sidebar panel.
 *
 * Clicking a thread preview card under a message opens the thread here (an
 * inline, read-along-and-reply panel next to the parent channel) rather than
 * navigating away to the full thread view. Clicking a thread from the channel
 * sidebar still opens it in full view via normal navigation, so this store is
 * intentionally independent of the {@link Threads} joined/preview state used by
 * the left channel list.
 */
class ThreadSidebar {
	/** The thread currently shown in the sidebar panel, or null when closed. */
	openThreadId: string | null = null;
	/** The parent channel the panel belongs to; the panel only renders there. */
	parentChannelId: string | null = null;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	isOpenForThread(threadId: string): boolean {
		return this.openThreadId === threadId;
	}

	open(threadId: string, parentChannelId: string): void {
		this.openThreadId = threadId;
		this.parentChannelId = parentChannelId;
	}

	toggle(threadId: string, parentChannelId: string): void {
		if (this.openThreadId === threadId) {
			this.close();
			return;
		}
		this.open(threadId, parentChannelId);
	}

	close(): void {
		this.openThreadId = null;
		this.parentChannelId = null;
	}

	/** Closes the panel unless it belongs to the given parent channel. */
	closeIfNotParent(parentChannelId: string | null | undefined): void {
		if (this.openThreadId != null && this.parentChannelId !== parentChannelId) {
			this.close();
		}
	}
}

export default new ThreadSidebar();
