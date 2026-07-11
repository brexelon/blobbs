// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import Channels from '@app/features/channel/state/Channels';
import Threads from '@app/features/channel/state/Threads';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import Permission from '@app/features/permissions/state/Permission';

/**
 * Navigate into a thread's full channel view, seeding the thread into the local
 * channel store first if it is not already present.
 *
 * Threads the user has not joined are not synced to the client — on desktop the
 * thread sidebar seeds them on demand, but the mobile layout has no sidebar, so
 * tapping a thread preview would navigate straight to a channel the store does
 * not know about and bounce to a fallback channel. Fetching the parent's thread
 * list resolves the thread through the same virtual access the sidebar uses
 * (anyone who can view the parent), then seeds it so navigation lands on it.
 */
export async function openThreadFullView(params: {
	guildId: string;
	threadId: string;
	parentChannelId: string;
}): Promise<void> {
	const {guildId, threadId, parentChannelId} = params;
	if (!Channels.getChannel(threadId)) {
		try {
			const threads = await ThreadCommands.listThreads(parentChannelId);
			const wire = threads.find((candidate) => candidate.id === threadId);
			if (wire) {
				Channels.handleChannelCreate({channel: wire});
				if (wire.joined) {
					Threads.join(threadId);
				}
				Permission.handleChannelUpdate(threadId);
			}
		} catch {
			// Best-effort seed; navigation still proceeds so the view can show its
			// own empty/inaccessible state rather than silently doing nothing.
		}
	}
	selectChannel(guildId, threadId);
}
