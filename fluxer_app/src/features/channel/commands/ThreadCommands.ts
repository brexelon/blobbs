// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import type {UserPartial} from '@fluxer/schema/src/domains/user/UserResponseSchemas';

const logger = new Logger('Threads');

export interface ThreadMember {
	user: UserPartial;
	joined_at: string;
}

export type ThreadStateAction = 'open' | 'close' | 'archive' | 'unarchive';

export interface ThreadCreateParams {
	name: string;
	auto_close_duration_seconds: number;
	message_id?: string | null;
}

export interface ThreadUpdateParams {
	name?: string;
	action?: ThreadStateAction;
}

export async function createThread(channelId: string, params: ThreadCreateParams): Promise<Channel> {
	try {
		const response = await http.post<Channel>(Endpoints.CHANNEL_THREADS(channelId), {body: params});
		return response.body;
	} catch (error) {
		logger.error(`Failed to create thread in channel ${channelId}:`, error);
		throw error;
	}
}

export async function listThreads(channelId: string): Promise<Array<Channel>> {
	try {
		const response = await http.get<{threads: Array<Channel>}>(Endpoints.CHANNEL_THREADS(channelId));
		return response.body.threads;
	} catch (error) {
		logger.error(`Failed to list threads in channel ${channelId}:`, error);
		throw error;
	}
}

export async function listThreadMembers(threadId: string): Promise<Array<ThreadMember>> {
	try {
		const response = await http.get<{members: Array<ThreadMember>}>(Endpoints.THREAD_MEMBERS(threadId));
		return response.body.members;
	} catch (error) {
		logger.error(`Failed to list members for thread ${threadId}:`, error);
		throw error;
	}
}

export async function joinThread(threadId: string): Promise<Channel> {
	try {
		const response = await http.post<Channel>(Endpoints.THREAD_JOIN(threadId), {body: {}});
		return response.body;
	} catch (error) {
		logger.error(`Failed to join thread ${threadId}:`, error);
		throw error;
	}
}

export async function leaveThread(threadId: string): Promise<void> {
	try {
		await http.post(Endpoints.THREAD_LEAVE(threadId), {body: {}});
	} catch (error) {
		logger.error(`Failed to leave thread ${threadId}:`, error);
		throw error;
	}
}

export async function updateThread(threadId: string, params: ThreadUpdateParams): Promise<Channel> {
	try {
		const response = await http.patch<Channel>(Endpoints.THREAD(threadId), {body: params});
		return response.body;
	} catch (error) {
		logger.error(`Failed to update thread ${threadId}:`, error);
		throw error;
	}
}

export async function deleteThread(threadId: string): Promise<void> {
	try {
		await http.delete(Endpoints.THREAD(threadId));
	} catch (error) {
		logger.error(`Failed to delete thread ${threadId}:`, error);
		throw error;
	}
}
