// SPDX-License-Identifier: AGPL-3.0-or-later

import * as BucketUtils from '@fluxer/snowflake/src/SnowflakeBuckets';
import type {ChannelID, GuildID, MessageID, UserID} from '../../../BrandedTypes';
import {deleteOneOrMany, fetchMany, fetchOne, upsertOne} from '../../../database/CassandraQueryExecution';
import {Db} from '../../../database/CassandraTypes';
import type {
	ThreadByAutoCloseRow,
	ThreadByParentRow,
	ThreadMemberByUserRow,
	ThreadMemberRow,
} from '../../../database/types/ChannelTypes';
import {Messages, ThreadMembers, ThreadMembersByUser, ThreadsByAutoClose, ThreadsByParent} from '../../../Tables';

const FETCH_MEMBER = ThreadMembers.selectCql({
	where: [ThreadMembers.where.eq('thread_id'), ThreadMembers.where.eq('user_id')],
});
const FETCH_MEMBERS_BY_THREAD = ThreadMembers.selectCql({
	where: ThreadMembers.where.eq('thread_id'),
});
const FETCH_THREADS_BY_USER = ThreadMembersByUser.selectCql({
	where: ThreadMembersByUser.where.eq('user_id'),
});
const FETCH_THREADS_BY_PARENT = ThreadsByParent.selectCql({
	where: ThreadsByParent.where.eq('parent_id'),
});
const FETCH_DUE_AUTO_CLOSE = ThreadsByAutoClose.selectCql({
	where: [ThreadsByAutoClose.where.eq('close_bucket'), ThreadsByAutoClose.where.lte('auto_close_at', 'current_time')],
	limit: 200,
});

/**
 * Day-granular bucket (YYYYMMDD) used to partition the auto-close sweep index,
 * mirroring the attachment-decay expiry bucketing so the sweep worker only scans
 * a bounded set of partitions.
 */
export function getAutoCloseBucket(date: Date): number {
	return Number(
		`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`,
	);
}

export class ThreadRepository {
	async addMember(params: {
		threadId: ChannelID;
		userId: UserID;
		guildId: GuildID | null;
		parentId: ChannelID | null;
		joinedAt: Date;
	}): Promise<void> {
		await Promise.all([
			upsertOne(
				ThreadMembers.upsertAll({
					thread_id: params.threadId,
					user_id: params.userId,
					joined_at: params.joinedAt,
				}),
			),
			upsertOne(
				ThreadMembersByUser.upsertAll({
					user_id: params.userId,
					thread_id: params.threadId,
					guild_id: params.guildId,
					parent_id: params.parentId,
					joined_at: params.joinedAt,
				}),
			),
		]);
	}

	async removeMember(params: {threadId: ChannelID; userId: UserID}): Promise<void> {
		await Promise.all([
			deleteOneOrMany(ThreadMembers.deleteByPk({thread_id: params.threadId, user_id: params.userId})),
			deleteOneOrMany(ThreadMembersByUser.deleteByPk({user_id: params.userId, thread_id: params.threadId})),
		]);
	}

	async isMember(threadId: ChannelID, userId: UserID): Promise<boolean> {
		const row = await fetchOne<ThreadMemberRow>(FETCH_MEMBER, {thread_id: threadId, user_id: userId});
		return row != null;
	}

	async listMembers(threadId: ChannelID): Promise<Array<ThreadMemberRow>> {
		return fetchMany<ThreadMemberRow>(FETCH_MEMBERS_BY_THREAD, {thread_id: threadId});
	}

	async listMemberThreads(userId: UserID): Promise<Array<ThreadMemberByUserRow>> {
		return fetchMany<ThreadMemberByUserRow>(FETCH_THREADS_BY_USER, {user_id: userId});
	}

	async indexUnderParent(params: {parentId: ChannelID; threadId: ChannelID; guildId: GuildID | null}): Promise<void> {
		await upsertOne(
			ThreadsByParent.upsertAll({
				parent_id: params.parentId,
				thread_id: params.threadId,
				guild_id: params.guildId,
			}),
		);
	}

	async removeFromParentIndex(parentId: ChannelID, threadId: ChannelID): Promise<void> {
		await deleteOneOrMany(ThreadsByParent.deleteByPk({parent_id: parentId, thread_id: threadId}));
	}

	async listThreadsByParent(parentId: ChannelID): Promise<Array<ThreadByParentRow>> {
		return fetchMany<ThreadByParentRow>(FETCH_THREADS_BY_PARENT, {parent_id: parentId});
	}

	async insertAutoCloseEntry(params: {
		autoCloseAt: Date;
		threadId: ChannelID;
		parentId: ChannelID | null;
		guildId: GuildID | null;
	}): Promise<void> {
		await upsertOne(
			ThreadsByAutoClose.upsertAll({
				close_bucket: getAutoCloseBucket(params.autoCloseAt),
				auto_close_at: params.autoCloseAt,
				thread_id: params.threadId,
				parent_id: params.parentId,
				guild_id: params.guildId,
			}),
		);
	}

	async deleteAutoCloseEntry(params: {closeBucket: number; autoCloseAt: Date; threadId: ChannelID}): Promise<void> {
		await deleteOneOrMany(
			ThreadsByAutoClose.deleteByPk({
				close_bucket: params.closeBucket,
				auto_close_at: params.autoCloseAt,
				thread_id: params.threadId,
			}),
		);
	}

	async fetchDueAutoCloseEntries(bucket: number, before: Date): Promise<Array<ThreadByAutoCloseRow>> {
		return fetchMany<ThreadByAutoCloseRow>(FETCH_DUE_AUTO_CLOSE, {close_bucket: bucket, current_time: before});
	}

	async annotateOriginMessage(params: {
		parentChannelId: ChannelID;
		messageId: MessageID;
		threadId: ChannelID;
		threadName: string;
	}): Promise<void> {
		await upsertOne(
			Messages.patchByPk(
				{
					channel_id: params.parentChannelId,
					bucket: BucketUtils.makeBucket(params.messageId),
					message_id: params.messageId,
				},
				{thread_id: Db.set(params.threadId), thread_name: Db.set(params.threadName)},
			),
		);
	}

	async clearOriginMessageAnnotation(params: {parentChannelId: ChannelID; messageId: MessageID}): Promise<void> {
		await upsertOne(
			Messages.patchByPk(
				{
					channel_id: params.parentChannelId,
					bucket: BucketUtils.makeBucket(params.messageId),
					message_id: params.messageId,
				},
				{thread_id: Db.clear(), thread_name: Db.clear()},
			),
		);
	}

	/**
	 * Detach a message from its thread while keeping thread_name. Used when a
	 * thread is deleted: the preview box (gated on thread_id) disappears, but a
	 * "started a thread: <name>" system message keeps its label.
	 */
	async clearOriginMessageThreadLink(params: {parentChannelId: ChannelID; messageId: MessageID}): Promise<void> {
		await upsertOne(
			Messages.patchByPk(
				{
					channel_id: params.parentChannelId,
					bucket: BucketUtils.makeBucket(params.messageId),
					message_id: params.messageId,
				},
				{thread_id: Db.clear()},
			),
		);
	}
}
