// SPDX-License-Identifier: AGPL-3.0-or-later

import {ChannelResponse} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {ThreadCreateRequest, ThreadUpdateRequest} from '@fluxer/schema/src/domains/channel/ThreadRequestSchemas';
import {ChannelIdParam, ThreadIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {z} from 'zod';
import {createChannelID} from '../../BrandedTypes';
import {LoginRequired} from '../../middleware/AuthMiddleware';
import {RateLimitMiddleware} from '../../middleware/RateLimitMiddleware';
import {OpenAPI} from '../../middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '../../RateLimitConfig';
import type {HonoApp} from '../../types/HonoEnv';
import {Validator} from '../../Validator';

const ThreadListResponse = z.object({
	threads: z.array(ChannelResponse).describe('Threads under this channel, ordered by most recent activity'),
});

const ThreadMembersResponse = z.object({
	members: z
		.array(
			z.object({
				user: UserPartialResponse.describe('The thread member'),
				joined_at: z.iso.datetime().describe('When the user joined the thread'),
			}),
		)
		.describe('Members who have access to the thread (creator and anyone who has sent a message)'),
});

export function ThreadController(app: HonoApp) {
	app.post(
		'/channels/:channel_id/threads',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('json', ThreadCreateRequest),
		OpenAPI({
			operationId: 'create_thread',
			summary: 'Create a thread',
			description:
				'Starts a new thread in a text channel, optionally rooted on an existing message. Requires the Create Threads permission in the parent channel.',
			requestSchema: ThreadCreateRequest,
			responseSchema: ChannelResponse,
			statusCode: 201,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const parentChannelId = createChannelID(ctx.req.valid('param').channel_id);
			const data = ctx.req.valid('json');
			const requestCache = ctx.get('requestCache');
			const response = await ctx.get('channelService').threads.createThread({
				userId: user.id,
				creatorUsername: user.username,
				parentChannelId,
				data,
				requestCache,
			});
			return ctx.json(response, 201);
		},
	);
	app.get(
		'/channels/:channel_id/threads',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_GET),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'list_channel_threads',
			summary: 'List threads in a channel',
			description:
				'Returns all threads (open, closed, and archived) under a channel, ordered by most recent message. Requires view access to the parent channel.',
			responseSchema: ThreadListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const parentChannelId = createChannelID(ctx.req.valid('param').channel_id);
			const requestCache = ctx.get('requestCache');
			return ctx.json(
				await ctx.get('channelService').threads.listThreads({userId: user.id, parentChannelId, requestCache}),
			);
		},
	);
	app.get(
		'/threads/:thread_id/members',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_GET),
		LoginRequired,
		Validator('param', ThreadIdParam),
		OpenAPI({
			operationId: 'list_thread_members',
			summary: 'List thread members',
			description:
				'Returns the users who have access to a thread (its creator plus anyone who has sent a message in it). Requires view access to the thread.',
			responseSchema: ThreadMembersResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const threadId = createChannelID(ctx.req.valid('param').thread_id);
			const requestCache = ctx.get('requestCache');
			return ctx.json(
				await ctx.get('channelService').threads.listThreadMembers({userId: user.id, threadId, requestCache}),
			);
		},
	);
	app.post(
		'/threads/:thread_id/join',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ThreadIdParam),
		OpenAPI({
			operationId: 'join_thread',
			summary: 'Join a thread',
			description: 'Adds the current user to a thread so it appears in their channel list and receives its events.',
			responseSchema: ChannelResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const threadId = createChannelID(ctx.req.valid('param').thread_id);
			const requestCache = ctx.get('requestCache');
			return ctx.json(await ctx.get('channelService').threads.joinThread({userId: user.id, threadId, requestCache}));
		},
	);
	app.post(
		'/threads/:thread_id/leave',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ThreadIdParam),
		OpenAPI({
			operationId: 'leave_thread',
			summary: 'Leave a thread',
			description: 'Removes the current user from a thread. Archived threads cannot be left.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const threadId = createChannelID(ctx.req.valid('param').thread_id);
			await ctx.get('channelService').threads.leaveThread({userId: user.id, threadId});
			return ctx.body(null, 204);
		},
	);
	app.patch(
		'/threads/:thread_id',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_UPDATE),
		LoginRequired,
		Validator('param', ThreadIdParam),
		Validator('json', ThreadUpdateRequest),
		OpenAPI({
			operationId: 'update_thread',
			summary: 'Update a thread',
			description:
				'Renames a thread or applies a lifecycle transition (open, close, archive, unarchive). Requires the Manage Channels permission in the parent channel.',
			requestSchema: ThreadUpdateRequest,
			responseSchema: ChannelResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const threadId = createChannelID(ctx.req.valid('param').thread_id);
			const data = ctx.req.valid('json');
			const requestCache = ctx.get('requestCache');
			return ctx.json(
				await ctx.get('channelService').threads.updateThread({userId: user.id, threadId, data, requestCache}),
			);
		},
	);
	app.delete(
		'/threads/:thread_id',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_DELETE),
		LoginRequired,
		Validator('param', ThreadIdParam),
		OpenAPI({
			operationId: 'delete_thread',
			summary: 'Delete a thread',
			description: 'Permanently removes a thread. Requires the Manage Channels permission in the parent channel.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const threadId = createChannelID(ctx.req.valid('param').thread_id);
			await ctx.get('channelService').threads.deleteThread({userId: user.id, threadId});
			return ctx.body(null, 204);
		},
	);
}
