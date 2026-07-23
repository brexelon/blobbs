// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import Channels from '@app/features/channel/state/Channels';
import ThreadSidebar from '@app/features/channel/state/ThreadSidebar';
import Threads from '@app/features/channel/state/Threads';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS} from '@fluxer/constants/src/ChannelConstants';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';

const logger = new Logger('ThreadCreateFlow');

const MAX_DERIVED_NAME_LENGTH = 100;
const DEFAULT_THREAD_NAME = 'New Thread';

/**
 * Derive a thread name from the starter message when the creator leaves the name
 * field blank, mirroring how Discord names a message-rooted thread. Falls back to
 * a generic label when the starter has no usable text (e.g. only whitespace).
 */
export function deriveThreadName(content: string): string {
	const firstLine = content.split('\n', 1)[0]?.trim() ?? '';
	if (!firstLine) {
		return DEFAULT_THREAD_NAME;
	}
	return firstLine.length > MAX_DERIVED_NAME_LENGTH ? firstLine.slice(0, MAX_DERIVED_NAME_LENGTH) : firstLine;
}

/**
 * Create a thread and post its required starter message, then open the thread
 * inline in the right-hand sidebar (or navigate into it in full view on mobile,
 * which has no side panel). The name is optional; when omitted it is derived from
 * the starter message. The starter message is sent to the new thread as an
 * ordinary message so it becomes the thread's first entry.
 */
export async function submitThreadCreate(params: {
	parentChannelId: string;
	guildId: string;
	name: string;
	content: string;
	originMessageId?: string | null;
}): Promise<void> {
	const name = params.name.trim() || deriveThreadName(params.content);
	const thread = await ThreadCommands.createThread(params.parentChannelId, {
		name,
		auto_close_duration_seconds: DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS,
		message_id: params.originMessageId ?? null,
	});
	// Seed the store so the thread renders immediately without waiting on the
	// THREAD_CREATE gateway round-trip, and treat the creator as a member.
	Channels.handleChannelCreate({channel: thread});
	Threads.join(thread.id);
	// Post the required starter message into the freshly created thread. The thread
	// already exists, so a failure here should not abort navigation into it.
	try {
		await http.post(Endpoints.CHANNEL_MESSAGES(thread.id), {
			body: {content: params.content, nonce: SnowflakeUtils.fromTimestamp(Date.now())},
		});
	} catch (error) {
		logger.error(`Failed to post starter message for thread ${thread.id}:`, error);
	}
	if (MobileLayout.isMobileLayout()) {
		// Mobile has no side panel: clear the full-screen create view and navigate
		// into the thread. Closing first prevents the create view from reappearing
		// when the user later returns to the parent channel.
		ThreadSidebar.close();
		selectChannel(params.guildId, thread.id);
	} else {
		ThreadSidebar.open(thread.id, params.parentChannelId);
	}
}
