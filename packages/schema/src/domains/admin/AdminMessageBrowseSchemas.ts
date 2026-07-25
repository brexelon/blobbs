// SPDX-License-Identifier: AGPL-3.0-or-later

import {AdminMessageSchema} from '@fluxer/schema/src/domains/admin/AdminSchemas';
import {MessageResponseSchema} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {Int32Type, SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const BrowseChannelRequest = z.object({
	channel_id: SnowflakeType,
	before: SnowflakeType.optional(),
	after: SnowflakeType.optional(),
	limit: z.number().int().min(1).max(100).default(50),
});

export type BrowseChannelRequest = z.infer<typeof BrowseChannelRequest>;

/**
 * Identity of the channel being browsed. Lets an admin surface browse a thread the
 * same way it browses a channel — labelling the view and linking back to the
 * thread's parent, creator, and guild — without a second lookup per field.
 */
export const BrowseChannelTarget = z.object({
	id: SnowflakeStringType.describe('The ID of the channel or thread being browsed'),
	type: Int32Type.describe('The channel type. 5 is a thread.'),
	name: z.string().nullish().describe('The channel name, or the thread name for a thread'),
	guild_id: SnowflakeStringType.nullish().describe('The guild the channel belongs to, if any'),
	parent_id: SnowflakeStringType.nullish().describe(
		'The parent category for a channel, or the parent channel for a thread',
	),
	parent_name: z.string().nullish().describe('Name of the parent channel, resolved for threads'),
	thread_creator_id: SnowflakeStringType.nullish().describe('The user who started the thread, for threads'),
	thread_creator_name: z
		.string()
		.nullish()
		.describe('The username of the thread creator at creation time, for threads'),
});

export type BrowseChannelTarget = z.infer<typeof BrowseChannelTarget>;

export const BrowseChannelResponse = z.object({
	messages: z.array(AdminMessageSchema).max(100),
	message_responses: z.array(MessageResponseSchema).max(100).optional(),
	has_more: z.boolean(),
	target: BrowseChannelTarget.nullish().describe('Identity of the browsed channel or thread'),
});

export type BrowseChannelResponse = z.infer<typeof BrowseChannelResponse>;

export const SearchChannelMessagesRequest = z.object({
	channel_id: SnowflakeType,
	query: z.string().min(1).max(200),
	limit: z.number().int().min(1).max(100).default(25),
});

export type SearchChannelMessagesRequest = z.infer<typeof SearchChannelMessagesRequest>;

export const SearchChannelMessagesResponse = z.object({
	messages: z.array(AdminMessageSchema).max(100),
	message_responses: z.array(MessageResponseSchema).max(100).optional(),
	total: z.number().int().min(0),
});

export type SearchChannelMessagesResponse = z.infer<typeof SearchChannelMessagesResponse>;
