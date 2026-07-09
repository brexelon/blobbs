// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS,
	THREAD_AUTO_CLOSE_DURATIONS_SECONDS,
} from '@fluxer/constants/src/ChannelConstants';
import {CHANNEL_RATE_LIMIT_PER_USER_MAX, CHANNEL_RATE_LIMIT_PER_USER_MIN} from '@fluxer/constants/src/LimitConstants';
import {GeneralChannelNameType} from '@fluxer/schema/src/primitives/ChannelValidators';
import {createNamedLiteralUnion, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

const AutoCloseDurationType = createNamedLiteralUnion(
	THREAD_AUTO_CLOSE_DURATIONS_SECONDS.map((seconds) => [seconds, `SECONDS_${seconds}`] as const),
	'How long the thread stays open after the last message before auto-closing (1h, 24h, 3d, or 7d in seconds)',
);

export const ThreadCreateRequest = z.object({
	name: GeneralChannelNameType.describe('The display name of the thread'),
	auto_close_duration_seconds: AutoCloseDurationType.default(DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS).describe(
		'Inactivity window before the thread auto-closes (defaults to 7 days)',
	),
	message_id: SnowflakeType.nullish().describe(
		'The ID of the message this thread is rooted on. Omit to start a standalone thread.',
	),
});

export type ThreadCreateRequest = z.infer<typeof ThreadCreateRequest>;

export const ThreadStateAction = z
	.enum(['open', 'close', 'archive', 'unarchive'])
	.describe('Thread lifecycle transition to apply');

export type ThreadStateAction = z.infer<typeof ThreadStateAction>;

export const ThreadUpdateRequest = z
	.object({
		name: GeneralChannelNameType.optional().describe('A new display name for the thread'),
		action: ThreadStateAction.optional().describe('A lifecycle transition to apply to the thread'),
		auto_close_duration_seconds: AutoCloseDurationType.optional().describe(
			'A new inactivity window before the thread auto-closes (1h, 24h, 3d, or 7d in seconds)',
		),
		rate_limit_per_user: z
			.number()
			.int()
			.min(CHANNEL_RATE_LIMIT_PER_USER_MIN)
			.max(CHANNEL_RATE_LIMIT_PER_USER_MAX)
			.optional()
			.describe(
				`A new slowmode delay in seconds (${CHANNEL_RATE_LIMIT_PER_USER_MIN}-${CHANNEL_RATE_LIMIT_PER_USER_MAX})`,
			),
	})
	.refine(
		(value) =>
			value.name !== undefined ||
			value.action !== undefined ||
			value.auto_close_duration_seconds !== undefined ||
			value.rate_limit_per_user !== undefined,
		{
			message: 'At least one field must be provided',
		},
	);

export type ThreadUpdateRequest = z.infer<typeof ThreadUpdateRequest>;
