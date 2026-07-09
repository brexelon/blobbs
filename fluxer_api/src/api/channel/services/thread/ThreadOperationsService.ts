// SPDX-License-Identifier: AGPL-3.0-or-later

import {AuditLogActionType} from '@fluxer/constants/src/AuditLogActionType';
import {
	ChannelTypes,
	GUILD_TEXT_BASED_CHANNEL_TYPES,
	MessageTypes,
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
import type {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {
	type ChannelID,
	createChannelID,
	createMessageID,
	type GuildID,
	type MessageID,
	type UserID,
} from '../../../BrandedTypes';
import type {ThreadByAutoCloseRow} from '../../../database/types/ChannelTypes';
import type {GuildAuditLogService} from '../../../guild/GuildAuditLogService';
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
import {dispatchMessageCreateBroadcast, dispatchMessageUpdateBroadcast} from '../message/MessageGatewayDispatch';
import type {MessagePersistenceService} from '../message/MessagePersistenceService';

const AUTO_CLOSE_DURATIONS = new Set<number>(THREAD_AUTO_CLOSE_DURATIONS_SECONDS);

export class ThreadOperationsService {
	constructor(
		private readonly channelRepository: IChannelRepository,
		private readonly threadRepository: ThreadRepository,
		private readonly authService: ChannelAuthService,
		private readonly gatewayService: IGatewayService,
		private readonly snowflakeService: ISnowflakeService,
		private readonly userCacheService: UserCacheService,
		private readonly messagePersistenceService: MessagePersistenceService,
		private readonly guildAuditLogService: GuildAuditLogService,
	) {}

	/**
	 * Record a community audit log entry for a thread lifecycle action, mirroring
	 * how channels are logged. Threads are channel rows, so the same channel
	 * serializer/diff drives the change set. Failures are swallowed — the thread
	 * mutation itself has already succeeded and must not be undone by a log write.
	 */
	/**
	 * Snapshot the thread fields that are meaningful in an audit diff: name,
	 * slowmode, auto-close window, and lifecycle state. Unlike the generic channel
	 * serializer this includes the thread-only fields, so an auto-close or state
	 * change is recorded (and rendered) rather than producing an empty change set.
	 */
	private serializeThreadForAudit(thread: Channel): Record<string, unknown> {
		return {
			name: thread.name ?? null,
			rate_limit_per_user: thread.rateLimitPerUser,
			thread_auto_close_duration_seconds: thread.threadAutoCloseDurationSeconds ?? null,
			thread_state: thread.threadState ?? null,
		};
	}

	private async recordThreadAuditLog(params: {
		guildId: GuildID;
		userId: UserID;
		threadId: ChannelID;
		action: AuditLogActionType;
		before: Channel | null;
		after: Channel | null;
	}): Promise<void> {
		const {guildId, userId, threadId, action, before, after} = params;
		const changes = this.guildAuditLogService.computeChanges(
			before ? this.serializeThreadForAudit(before) : null,
			after ? this.serializeThreadForAudit(after) : null,
		);
		if (action === AuditLogActionType.THREAD_UPDATE && changes.length === 0) {
			return;
		}
		try {
			await this.guildAuditLogService
				.createBuilder(guildId, userId)
				.withAction(action, threadId.toString())
				.withReason(null)
				.withMetadata({type: ChannelTypes.GUILD_THREAD.toString()})
				.withChanges(changes)
				.commit();
		} catch (error) {
			Logger.error(
				{error, guildId: guildId.toString(), userId: userId.toString(), action, targetId: threadId.toString()},
				'Failed to record thread audit log',
			);
		}
	}

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
		// For standalone creation we announce the thread with a system message and
		// treat it as the origin message, so deleting the thread can find and clean
		// it up exactly like a message-originated thread. Pre-generate its id here so
		// the thread row can reference it up front.
		const systemMessageId =
			originMessageId == null
				? createMessageID(await this.snowflakeService.generateForChannel(parentChannelId.toString()))
				: null;
		const threadOriginMessageId = originMessageId ?? systemMessageId;
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
			thread_origin_message_id: threadOriginMessageId,
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
		await this.recordThreadAuditLog({
			guildId,
			userId,
			threadId,
			action: AuditLogActionType.THREAD_CREATE,
			before: null,
			after: thread,
		});
		try {
			if (originMessageId != null) {
				// The thread grew out of an existing message: re-broadcast it so every
				// viewer renders the thread preview card beneath it without a refresh.
				await this.broadcastOriginMessageUpdate({parent, messageId: originMessageId});
			} else if (systemMessageId != null) {
				// The thread was started standalone (topbar "Create" / /thread): post a
				// "started a thread" system message carrying the thread annotation, so it
				// surfaces in the channel with its own preview card, like the origin case.
				await this.postThreadCreatedSystemMessage({
					parent,
					guildId,
					creatorId: userId,
					messageId: systemMessageId,
					threadId,
					threadName: data.name,
				});
			}
		} catch (error) {
			// The thread itself is already created and announced; a failure to surface
			// the preview/system message must not fail the request.
			Logger.warn({error, threadId: threadId.toString()}, 'Failed to surface thread creation in channel');
		}
		return response;
	}

	private async postThreadNameChangeSystemMessage(params: {
		thread: Channel;
		guildId: GuildID;
		userId: UserID;
		newName: string;
	}): Promise<void> {
		const {thread, guildId, userId, newName} = params;
		const messageId = createMessageID(await this.snowflakeService.generateForChannel(thread.id.toString()));
		const message = await this.messagePersistenceService.createSystemMessage({
			messageId,
			channelId: thread.id,
			userId,
			type: MessageTypes.CHANNEL_NAME_CHANGE,
			content: newName,
			guildId,
		});
		await dispatchMessageCreateBroadcast({gatewayService: this.gatewayService, channel: thread, message});
	}

	private async broadcastOriginMessageUpdate(params: {parent: Channel; messageId: MessageID}): Promise<void> {
		const {parent, messageId} = params;
		const message = await this.channelRepository.getMessage(parent.id, messageId);
		if (!message) return;
		await dispatchMessageUpdateBroadcast({gatewayService: this.gatewayService, channel: parent, message});
	}

	private async postThreadCreatedSystemMessage(params: {
		parent: Channel;
		guildId: GuildID;
		creatorId: UserID;
		messageId: MessageID;
		threadId: ChannelID;
		threadName: string;
	}): Promise<void> {
		const {parent, guildId, creatorId, messageId, threadId, threadName} = params;
		await this.messagePersistenceService.createSystemMessage({
			messageId,
			channelId: parent.id,
			userId: creatorId,
			type: MessageTypes.THREAD_CREATED,
			guildId,
		});
		await this.threadRepository.annotateOriginMessage({
			parentChannelId: parent.id,
			messageId,
			threadId,
			threadName,
		});
		const message = await this.channelRepository.getMessage(parent.id, messageId);
		if (!message) return;
		await dispatchMessageCreateBroadcast({gatewayService: this.gatewayService, channel: parent, message});
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

	async listJoinedThreads(params: {
		userId: UserID;
		requestCache: RequestCache;
	}): Promise<{threads: Array<ChannelResponse>}> {
		const {userId, requestCache} = params;
		const rows = await this.threadRepository.listMemberThreads(userId);
		if (rows.length === 0) {
			return {threads: []};
		}
		const channels = await this.channelRepository.listChannels(rows.map((row) => row.thread_id));
		const threads = channels.filter((channel) => channel.type === ChannelTypes.GUILD_THREAD && !channel.isSoftDeleted);
		threads.sort((a, b) => Number((b.lastMessageId ?? 0n) - (a.lastMessageId ?? 0n)));
		const responses = await Promise.all(threads.map((thread) => this.mapThread(thread, true, requestCache)));
		return {threads: responses};
	}

	async listThreadMembers(params: {
		userId: UserID;
		threadId: ChannelID;
		requestCache: RequestCache;
	}): Promise<{members: Array<{user: UserPartialResponse; joined_at: string}>}> {
		const {userId, threadId, requestCache} = params;
		const thread = await this.loadThread(threadId);
		await this.authService.getChannelAuthenticated({userId, channelId: thread.parentId ?? threadId});
		const rows = await this.threadRepository.listMembers(threadId);
		if (rows.length === 0) {
			return {members: []};
		}
		const partials = await this.userCacheService.getUserPartialResponses(
			rows.map((row) => row.user_id),
			requestCache,
		);
		const members: Array<{user: UserPartialResponse; joined_at: string}> = [];
		for (const row of rows) {
			const user = partials.get(row.user_id);
			if (user == null) {
				continue;
			}
			members.push({user, joined_at: row.joined_at.toISOString()});
		}
		return {members};
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

	/**
	 * Moderator action: remove another member from a thread. Requires Manage
	 * Channels in the parent channel. Announces the removal with a system message
	 * in the thread ("X removed Y from the thread") so it reads like the group DM
	 * recipient-removal notice.
	 */
	async removeThreadMember(params: {
		moderatorUserId: UserID;
		threadId: ChannelID;
		targetUserId: UserID;
	}): Promise<void> {
		const {moderatorUserId, threadId, targetUserId} = params;
		const thread = await this.loadThread(threadId);
		const guildId = thread.guildId!;
		const auth = await this.authService.getChannelAuthenticated({
			userId: moderatorUserId,
			channelId: thread.parentId ?? threadId,
		});
		await auth.checkPermission(Permissions.MANAGE_CHANNELS);
		if (!(await this.threadRepository.isMember(threadId, targetUserId))) {
			return;
		}
		await this.threadRepository.removeMember({threadId, userId: targetUserId});
		await this.dispatchMemberEvent('THREAD_MEMBER_REMOVE', {threadId, guildId, userId: targetUserId});
		try {
			const messageId = createMessageID(await this.snowflakeService.generateForChannel(threadId.toString()));
			const message = await this.messagePersistenceService.createSystemMessage({
				messageId,
				channelId: threadId,
				userId: moderatorUserId,
				type: MessageTypes.THREAD_MEMBER_REMOVE,
				guildId,
				mentionUserIds: [targetUserId],
			});
			await dispatchMessageCreateBroadcast({gatewayService: this.gatewayService, channel: thread, message});
		} catch (error) {
			Logger.warn({error, threadId: threadId.toString()}, 'Failed to post thread member removal system message');
		}
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
		if (data.rate_limit_per_user !== undefined) {
			row.rate_limit_per_user = data.rate_limit_per_user;
		}
		if (data.auto_close_duration_seconds !== undefined) {
			if (!AUTO_CLOSE_DURATIONS.has(data.auto_close_duration_seconds)) {
				throw InputValidationError.fromCode(
					'auto_close_duration_seconds',
					ValidationErrorCodes.INVALID_THREAD_AUTO_CLOSE_DURATION,
				);
			}
			row.thread_auto_close_duration_seconds = data.auto_close_duration_seconds;
			// Re-base the deadline off the same last activity under the new window
			// (last activity = current deadline - old window), so a longer window
			// grants more time and a shorter one takes effect immediately.
			const oldDurationMs = (thread.threadAutoCloseDurationSeconds ?? 0) * 1000;
			const lastActivityMs = thread.threadAutoCloseAt ? thread.threadAutoCloseAt.getTime() - oldDurationMs : Date.now();
			const autoCloseAt = new Date(lastActivityMs + data.auto_close_duration_seconds * 1000);
			row.thread_auto_close_at = autoCloseAt;
			if (row.thread_state !== ThreadStates.ARCHIVED && thread.parentId != null) {
				await this.threadRepository.insertAutoCloseEntry({
					autoCloseAt,
					threadId,
					parentId: thread.parentId,
					guildId,
				});
			}
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
		if (data.name !== undefined && data.name !== thread.name) {
			// Announce the rename inside the thread with a system message, mirroring the
			// channel rename notice. A failure here must not fail the update itself.
			try {
				await this.postThreadNameChangeSystemMessage({thread: updated, guildId, userId, newName: data.name});
			} catch (error) {
				Logger.warn({error, threadId: threadId.toString()}, 'Failed to post thread rename system message');
			}
		}
		await this.recordThreadAuditLog({
			guildId,
			userId,
			threadId,
			action: AuditLogActionType.THREAD_UPDATE,
			before: thread,
			after: updated,
		});
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
				// Detach the origin/announcement message so its preview box drops, but
				// keep any "started a thread" system message readable.
				await this.threadRepository.clearOriginMessageThreadLink({
					parentChannelId: thread.parentId,
					messageId: thread.threadOriginMessageId,
				});
			}
		}
		await this.gatewayService.dispatchGuild({
			guildId,
			event: 'THREAD_DELETE',
			data: {
				id: threadId.toString(),
				guild_id: guildId.toString(),
				parent_id: thread.parentId?.toString() ?? null,
				origin_message_id: thread.threadOriginMessageId?.toString() ?? null,
			},
		});
		await this.recordThreadAuditLog({
			guildId,
			userId,
			threadId,
			action: AuditLogActionType.THREAD_DELETE,
			before: thread,
			after: null,
		});
	}

	/**
	 * Post-message-send hook. When a message lands in a thread the author is
	 * auto-joined, a closed thread reopens, and the inactivity timer is reset.
	 * A no-op for non-thread channels.
	 */
	async handleThreadMessageActivity(params: {
		channelId: ChannelID;
		userId: UserID;
		mentionedUserIds?: ReadonlyArray<UserID>;
	}): Promise<void> {
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
			await this.addMentionedThreadMembers({
				thread: channel,
				guildId,
				authorId: userId,
				mentionedUserIds: params.mentionedUserIds ?? [],
			});
		} catch (error) {
			Logger.warn({error, threadId: channel.id.toString()}, 'Failed to record thread message activity');
		}
	}

	/**
	 * Add users mentioned in a thread message as thread members, mirroring
	 * Discord: an @mention pulls a non-member into the thread so they receive its
	 * traffic. Each candidate is gated on being able to view the thread's parent
	 * channel, skipped if already a member, and failures are isolated per user so
	 * one bad mention never blocks the rest.
	 */
	private async addMentionedThreadMembers(params: {
		thread: Channel;
		guildId: GuildID;
		authorId: UserID;
		mentionedUserIds: ReadonlyArray<UserID>;
	}): Promise<void> {
		const {thread, guildId, authorId, mentionedUserIds} = params;
		const parentChannelId = thread.parentId ?? thread.id;
		const authorKey = authorId.toString();
		const seen = new Set<string>();
		for (const mentionedId of mentionedUserIds) {
			const key = mentionedId.toString();
			if (key === authorKey || seen.has(key)) continue;
			seen.add(key);
			try {
				if (await this.threadRepository.isMember(thread.id, mentionedId)) continue;
				// Only pull in users who can actually see the thread's parent channel.
				await this.authService.getChannelAuthenticated({userId: mentionedId, channelId: parentChannelId});
				await this.threadRepository.addMember({
					threadId: thread.id,
					userId: mentionedId,
					guildId,
					parentId: thread.parentId,
					joinedAt: new Date(),
				});
				await this.dispatchMemberEvent('THREAD_MEMBER_ADD', {threadId: thread.id, guildId, userId: mentionedId});
			} catch (error) {
				Logger.debug({error, threadId: thread.id.toString(), userId: key}, 'Skipped adding mentioned user to thread');
			}
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
