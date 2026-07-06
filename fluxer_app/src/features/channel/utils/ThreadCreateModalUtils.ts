// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import Channels from '@app/features/channel/state/Channels';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS} from '@fluxer/constants/src/ChannelConstants';

export interface ThreadFormInputs {
	name: string;
	auto_close_duration_seconds: string;
}

export interface ThreadDurationOption {
	value: number;
	name: string;
	desc: string;
}

export const threadDurationOptions: Array<ThreadDurationOption> = [
	{value: 3600, name: '1 hour', desc: 'Closes 1 hour after the last message'},
	{value: 86400, name: '24 hours', desc: 'Closes 24 hours after the last message'},
	{value: 259200, name: '3 days', desc: 'Closes 3 days after the last message'},
	{value: 604800, name: '7 days', desc: 'Closes 7 days after the last message'},
];

export function getThreadDefaultValues(): Partial<ThreadFormInputs> {
	return {
		auto_close_duration_seconds: DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS.toString(),
	};
}

export async function createThread(
	channelId: string,
	guildId: string,
	data: ThreadFormInputs,
	messageId?: string | null,
): Promise<void> {
	const thread = await ThreadCommands.createThread(channelId, {
		name: data.name,
		auto_close_duration_seconds: Number(data.auto_close_duration_seconds),
		message_id: messageId ?? null,
	});
	// Seed the store from the create response so navigation renders the thread
	// immediately, without waiting on the THREAD_CREATE gateway round-trip.
	Channels.handleChannelCreate({channel: thread});
	setTimeout(() => {
		selectChannel(guildId, thread.id);
	}, 50);
	ModalCommands.pop();
}
