// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	ChannelTypes,
	GUILD_TEXT_BASED_CHANNEL_TYPES,
	Permissions,
	THREAD_AUTO_CLOSE_DURATIONS_SECONDS,
	ThreadStates,
} from '@fluxer/constants/src/ChannelConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {UnknownMessageError} from '@fluxer/errors/src/domains/channel/UnknownMessageError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import type {ChannelResponse} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import type {ThreadCreateRequest, ThreadUpdateRequest} from '@fluxer/schema/src/domains/channel/ThreadRequestSchemas';
import {type ChannelID, createChannelID, createMessageID, type GuildID, type UserID} from '../../../BrandedTypes';
import type {ThreadByAutoCloseRow} from '../../../database/types/ChannelTypes';
import type {IGatewayService} from '../../../infrastructure/IGatewayService';
import type {ISnowflakeService} from '../../../infrastructure/ISnowflakeService';
import type {UserCacheService} from '../../../infrastructure/UserCacheService';
import {Logger} from '../../../Logger';
import {createRequestCache, type RequestCache} from '../../../middleware/RequestCacheMiddleware';
import type {Channel} from '../../../models/Channel';
import {mapChannelToResponse} from '../../ChannelMappers';
import type {IChannelRepository} from '../../IChannelRepository';
import {getAutoCloseBucket, type ThreadRepository} from '../../repositories/thread/ThreadRepository';
import type {ChannelAuthService} from '../channel_data/ChannelAuthService';

const AUTO_CLOSE_DURATIONS = new Set<number>(THREAD_AUTO_CLOSE_DURATIONS_SECONDS);

export class ThreadOperationsService {
	constructor(
		private readonly channelRepository: IChannelRepository,
		private readonly threadRepository: ThreadRepository,
		private readonly authService: ChannelAuthService,
		private readonly gatewayService: IGatewayService,
		private readonly snowflakeService: ISnowflakeService,
		private readonly userCacheService: UserCacheService,
	) {}

	async createThread(params: {
		userId: UserID;
		creatorUsername: string;
		parentChannelId: ChannelID;
		data: ThreadCreateRequest;
		requestCache: RequestCache;
	}): Promise<ChannelResponse> {
		const {userId, parentChannelId, data, requestCache} = params;
		const auth = await this.authService.getChannelAuthenticated({userId, channelId: parentChannelId});
		const parent = auth.channel;
		if (parent.guildId == null || !this.isThreadableParent(parent)) {
			throw InputValidationError.fromCode('channel_id', ValidationErrorCodes.THREADS_NOT_SUPPORTED_IN_CHANNEL);
		}
		await auth.checkPermission(Permissions.CREATE_THREADS);
		if (!AUTO_CLOSE_DURATIONS.has(data.auto_close_duration_seconds)) {
			throw InputValidationError.fromCode(
				'auto_close_duration_seconds',
				ValidationErrorCodes.INVALID_THREAD_AUTO_CLOSE_DURATION,
			);
		}
		const guildId = parent.guildId;
		const originMessageId = data.message_id ? createMessageID(BigInt(data.message_id)) : null;
		if (originMessageId != null) {
			const originMessage = await this.channelRepository.getMessage(parentChannelId, originMessageId);
			if (!originMessage) {
				throw new UnknownMessageError();
			}
			if (originMessage.threadId != null) {
				throw InputValidationError.fromCode('message_id', ValidationErrorCodes.THREAD_ALREADY_EXISTS_ON_MESSAGE);
			}
		}
		const threadId = createChannelID(await this.snowflakeService.generateForChannel(parentChannelId.toString()));
		const now = new Date();
		const autoCloseAt = new Date(now.getTime() + data.auto_close_duration_seconds * 1000);
		const thread = await this.channelRepository.upsert({
			channel_id: threadId,
			guild_id: guildId,
			type: ChannelTypes.GUILD_THREAD,
			name: data.name,
			topic: null,
			icon_hash: null,
			url: null,
			parent_id: parentChannelId,
			position: 0,
			owner_id: userId,
			recipient_ids: null,
			nsfw: parent.nsfwOverride,
			content_warning_level: 0,
			content_warning_text: null,
			rate_limit_per_user: 0,
			bitrate: null,
			user_limit: null,
			voice_connection_limit: null,
			rtc_region: null,
			last_message_id: null,
			last_pin_timestamp: null,
			permission_overwrites: null,
			nicks: null,
			thread_id: threadId,
			thread_name: data.name,
			thread_creator_id: userId,
			thread_creator_name: params.creatorUsername,
			thread_state: ThreadStates.OPEN,
			thread_auto_close_duration_seconds: data.auto_close_duration_seconds,
			thread_auto_close_at: autoCloseAt,
			thread_origin_message_id: originMessageId,
			soft_deleted: false,
			indexed_at: null,
			version: 1,
		});
		await Promise.all([
			this.threadRepository.indexUnderParent({parentId: parentChannelId, threadId, guildId}),
			this.threadRepository.addMember({threadId, userId, guildId, parentId: parentChannelId, joinedAt: now}),
			this.threadRepository.insertAutoCloseEntry({autoCloseAt, threadId, parentId: parentChannelId, guildId}),
		]);
		if (originMessageId != null) {
			await this.threadRepository.annotateOriginMessage({
				parentChannelId,
				messageId: originMessageId,
				threadId,
				threadName: data.name,
			});
		}
		const response = await this.mapThread(thread, true, requestCache);
		await this.gatewayService.dispatchGuild({guildId, event: 'THREAD_CREATE', data: response});
		await this.dispatchMemberEvent('THREAD_MEMBER_ADD', {threadId, guildId, userId});
		return response;
	}

	async listThreads(params: {
		userId: UserID;
		parentChannelId: ChannelID;
		requestCache: RequestCache;
	}): Promise<{threads: Array<ChannelResponse>}> {
		const {userId, parentChannelId, requestCache} = params;
		await this.authService.getChannelAuthenticated({userId, channelId: parentChannelId});
		const index = await this.threadRepository.listThreadsByParent(parentChannelId);
		if (index.length === 0) return {threads: []};
		const channels = await this.channelRepository.listChannels(index.map((row) => row.thread_id));
		const threads = channels.filter((channel) => channel.type === ChannelTypes.GUILD_THREAD && !channel.isSoftDeleted);
		threads.sort((a, b) => Number((b.lastMessageId ?? 0n) - (a.lastMessageId ?? 0n)));
		const memberships = new Set((await this.threadRepository.listMemberThreads(userId)).map((row) => row.thread_id));
		const responses = await Promise.all(
			threads.map((thread) => this.mapThread(thread, memberships.has(thread.id), requestCache)),
		);
		return {threads: responses};
	}

	async joinThread(params: {
		userId: UserID;
		threadId: ChannelID;
		requestCache: RequestCache;
	}): Promise<ChannelResponse> {
		const {userId, threadId, requestCache} = params;
		const thread = await this.loadThread(threadId);
		if (thread.threadState === ThreadStates.ARCHIVED) {
			throw InputValidationError.fromCode('thread_id', ValidationErrorCodes.THREAD_ARCHIVED);
		}
		const guildId = thread.guildId!;
		await this.authService.getChannelAuthenticated({userId, channelId: thread.parentId ?? threadId});
		await this.threadRepository.addMember({
			threadId,
			userId,
			guildId,
			parentId: thread.parentId,
			joinedAt: new Date(),
		});
		await this.dispatchMemberEvent('THREAD_MEMBER_ADD', {threadId, guildId, userId});
		return this.mapThread(thread, true, requestCache);
	}

	async leaveThread(params: {userId: UserID; threadId: ChannelID}): Promise<void> {
		const {userId, threadId} = params;
		const thread = await this.loadThread(threadId);
		if (thread.threadState === ThreadStates.ARCHIVED) {
			throw InputValidationError.fromCode('thread_id', ValidationErrorCodes.THREAD_ARCHIVED);
		}
		await this.threadRepository.removeMember({threadId, userId});
		await this.dispatchMemberEvent('THREAD_MEMBER_REMOVE', {threadId, guildId: thread.guildId!, userId});
	}

	async updateThread(params: {
		userId: UserID;
		threadId: ChannelID;
		data: ThreadUpdateRequest;
		requestCache: RequestCache;
	}): Promise<ChannelResponse> {
		const {userId, threadId, data, requestCache} = params;
		const thread = await this.loadThread(threadId);
		const guildId = thread.guildId!;
		const auth = await this.authService.getChannelAuthenticated({userId, channelId: thread.parentId ?? threadId});
		await auth.checkPermission(Permissions.MANAGE_CHANNELS);
		const row = thread.toRow();
		if (data.action) {
			const nextState = this.resolveStateTransition(thread.threadState ?? ThreadStates.OPEN, data.action);
			row.thread_state = nextState;
			if (nextState === ThreadStates.OPEN) {
				const autoCloseAt = new Date(Date.now() + (thread.threadAutoCloseDurationSeconds ?? 0) * 1000);
				row.thread_auto_close_at = autoCloseAt;
				await this.threadRepository.insertAutoCloseEntry({
					autoCloseAt,
					threadId,
					parentId: thread.parentId,
					guildId,
				});
			}
		}
		if (data.name !== undefined) {
			row.name = data.name;
			row.thread_name = data.name;
		}
		const updated = await this.channelRepository.upsert(row);
		if (data.name !== undefined && thread.threadOriginMessageId != null && thread.parentId != null) {
			await this.threadRepository.annotateOriginMessage({
				parentChannelId: thread.parentId,
				messageId: thread.threadOriginMessageId,
				threadId,
				threadName: data.name,
			});
		}
		if (data.action === 'unarchive') {
			await this.rejoinAllMembers(threadId, guildId);
		}
		const response = await this.mapThread(updated, undefined, requestCache);
		await this.gatewayService.dispatchGuild({guildId, event: 'THREAD_UPDATE', data: response});
		return response;
	}

	async deleteThread(params: {userId: UserID; threadId: ChannelID}): Promise<void> {
		const {userId, threadId} = params;
		const thread = await this.loadThread(threadId);
		const guildId = thread.guildId!;
		const auth = await this.authService.getChannelAuthenticated({userId, channelId: thread.parentId ?? threadId});
		await auth.checkPermission(Permissions.MANAGE_CHANNELS);
		await this.channelRepository.delete(threadId, guildId);
		if (thread.parentId != null) {
			await this.threadRepository.removeFromParentIndex(thread.parentId, threadId);
			if (thread.threadOriginMessageId != null) {
				await this.threadRepository.clearOriginMessageAnnotation({
					parentChannelId: thread.parentId,
					messageId: thread.threadOriginMessageId,
				});
			}
		}
		await this.gatewayService.dispatchGuild({
			guildId,
			event: 'THREAD_DELETE',
			data: {id: threadId.toString(), guild_id: guildId.toString(), parent_id: thread.parentId?.toString() ?? null},
		});
	}

	/**
	 * Post-message-send hook. When a message lands in a thread the author is
	 * auto-joined, a closed thread reopens, and the inactivity timer is reset.
	 * A no-op for non-thread channels.
	 */
	async handleThreadMessageActivity(params: {channelId: ChannelID; userId: UserID}): Promise<void> {
		const {userId} = params;
		const channel = await this.channelRepository.findUnique(params.channelId);
		if (!channel || channel.type !== ChannelTypes.GUILD_THREAD || channel.isSoftDeleted) return;
		if (channel.threadState === ThreadStates.ARCHIVED) return;
		const guildId = channel.guildId;
		if (guildId == null) return;
		const now = new Date();
		const autoCloseAt = new Date(now.getTime() + (channel.threadAutoCloseDurationSeconds ?? 0) * 1000);
		const row = channel.toRow();
		row.thread_state = ThreadStates.OPEN;
		row.thread_auto_close_at = autoCloseAt;
		const wasReopened = channel.threadState === ThreadStates.CLOSED;
		try {
			const updated = await this.channelRepository.upsert(row);
			await Promise.all([
				this.threadRepository.addMember({
					threadId: channel.id,
					userId,
					guildId,
					parentId: channel.parentId,
					joinedAt: now,
				}),
				this.threadRepository.insertAutoCloseEntry({
					autoCloseAt,
					threadId: channel.id,
					parentId: channel.parentId,
					guildId,
				}),
			]);
			await this.dispatchMemberEvent('THREAD_MEMBER_ADD', {threadId: channel.id, guildId, userId});
			if (wasReopened) {
				await this.gatewayService.dispatchGuild({
					guildId,
					event: 'THREAD_UPDATE',
					data: await this.mapThread(updated, undefined, null),
				});
			}
		} catch (error) {
			Logger.warn({error, threadId: channel.id.toString()}, 'Failed to record thread message activity');
		}
	}

	/**
	 * Sweep a single auto-close index entry: closes the thread if its deadline
	 * has genuinely passed, otherwise removes the now-stale index row. Called by
	 * the periodic close-expired-threads worker.
	 */
	async sweepAutoCloseEntry(entry: ThreadByAutoCloseRow, now: Date): Promise<'closed' | 'stale'> {
		const deleteEntry = () =>
			this.threadRepository.deleteAutoCloseEntry({
				closeBucket: entry.close_bucket,
				autoCloseAt: entry.auto_close_at,
				threadId: entry.thread_id,
			});
		const thread = await this.channelRepository.findUnique(entry.thread_id);
		if (
			!thread ||
			thread.type !== ChannelTypes.GUILD_THREAD ||
			thread.isSoftDeleted ||
			thread.threadState !== ThreadStates.OPEN ||
			(thread.threadAutoCloseAt != null && thread.threadAutoCloseAt.getTime() > now.getTime())
		) {
			await deleteEntry();
			return 'stale';
		}
		const row = thread.toRow();
		row.thread_state = ThreadStates.CLOSED;
		const updated = await this.channelRepository.upsert(row);
		await deleteEntry();
		if (thread.guildId != null) {
			await this.gatewayService.dispatchGuild({
				guildId: thread.guildId,
				event: 'THREAD_UPDATE',
				data: await this.mapThread(updated, undefined, null),
			});
		}
		return 'closed';
	}

	async fetchDueAutoCloseEntries(bucket: number, before: Date): Promise<Array<ThreadByAutoCloseRow>> {
		return this.threadRepository.fetchDueAutoCloseEntries(bucket, before);
	}

	getAutoCloseBucket(date: Date): number {
		return getAutoCloseBucket(date);
	}

	private async rejoinAllMembers(threadId: ChannelID, guildId: GuildID): Promise<void> {
		const members = await this.threadRepository.listMembers(threadId);
		for (const member of members) {
			await this.dispatchMemberEvent('THREAD_MEMBER_ADD', {threadId, guildId, userId: member.user_id});
		}
	}

	private resolveStateTransition(current: number, action: ThreadUpdateRequest['action']): number {
		switch (action) {
			case 'open':
				if (current === ThreadStates.ARCHIVED) {
					throw InputValidationError.fromCode('action', ValidationErrorCodes.THREAD_INVALID_STATE_TRANSITION);
				}
				return ThreadStates.OPEN;
			case 'close':
				return ThreadStates.CLOSED;
			case 'archive':
				return ThreadStates.ARCHIVED;
			case 'unarchive':
				return ThreadStates.OPEN;
			default:
				throw InputValidationError.fromCode('action', ValidationErrorCodes.THREAD_INVALID_STATE_TRANSITION);
		}
	}

	private isThreadableParent(channel: Channel): boolean {
		return channel.type !== ChannelTypes.GUILD_THREAD && GUILD_TEXT_BASED_CHANNEL_TYPES.has(channel.type);
	}

	private async loadThread(threadId: ChannelID): Promise<Channel> {
		const thread = await this.channelRepository.findUnique(threadId);
		if (!thread || thread.type !== ChannelTypes.GUILD_THREAD || thread.isSoftDeleted || thread.guildId == null) {
			throw new UnknownChannelError();
		}
		return thread;
	}

	private async mapThread(
		thread: Channel,
		isThreadMember: boolean | undefined,
		requestCache: RequestCache | null,
	): Promise<ChannelResponse> {
		return mapChannelToResponse({
			channel: thread,
			currentUserId: null,
			userCacheService: this.userCacheService,
			requestCache: requestCache ?? createRequestCache(),
			isThreadMember,
		});
	}

	private async dispatchMemberEvent(
		event: 'THREAD_MEMBER_ADD' | 'THREAD_MEMBER_REMOVE',
		params: {threadId: ChannelID; guildId: GuildID; userId: UserID},
	): Promise<void> {
		await this.gatewayService.dispatchGuild({
			guildId: params.guildId,
			event,
			data: {
				thread_id: params.threadId.toString(),
				guild_id: params.guildId.toString(),
				user_id: params.userId.toString(),
			},
		});
	}
}
