// SPDX-License-Identifier: AGPL-3.0-or-later

import * as MessagingMessage from '@app/features/messaging/models/MessagingMessage';
import {
	isMessageMentionLike,
	shouldNotifyForMessage,
	type MessageNotificationChannel,
} from '@app/features/notification/utils/MessageNotificationEligibility';
import UserGuildSettings from '@app/features/user/state/UserGuildSettings';
import {MessageNotifications} from '@fluxer/constants/src/NotificationConstants';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const GUILD_ID = '100';
const CHANNEL_ID = '200';

function guildChannel(overrides: Partial<MessageNotificationChannel> = {}): MessageNotificationChannel {
	return {
		id: CHANNEL_ID,
		guildId: GUILD_ID,
		parentId: undefined,
		type: 0,
		isPrivate: () => false,
		...overrides,
	};
}

function wireMessage(overrides: Partial<WireMessage> = {}): WireMessage {
	return {
		id: '1',
		channel_id: CHANNEL_ID,
		guild_id: GUILD_ID,
		author: {id: '9', username: 'author', discriminator: '0'},
		content: 'hello',
		timestamp: new Date().toISOString(),
		edited_timestamp: null,
		tts: false,
		mention_everyone: false,
		mentions: [],
		mention_roles: [],
		mention_channels: [],
		attachments: [],
		embeds: [],
		pinned: false,
		type: 0,
		flags: 0,
		...overrides,
	} as WireMessage;
}

describe('MessageNotificationEligibility', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('allows mention notifications when the community is set to only mentions', () => {
		vi.spyOn(UserGuildSettings, 'resolvedMessageNotifications').mockReturnValue(MessageNotifications.ONLY_MENTIONS);
		vi.spyOn(UserGuildSettings, 'isGuildOrCategoryOrChannelMuted').mockReturnValue(false);
		vi.spyOn(MessagingMessage, 'messageMentionsCurrentUser').mockReturnValue(true);

		expect(shouldNotifyForMessage(guildChannel(), wireMessage())).toBe(true);
	});

	it('blocks non-mention notifications when the community is set to only mentions', () => {
		vi.spyOn(UserGuildSettings, 'resolvedMessageNotifications').mockReturnValue(MessageNotifications.ONLY_MENTIONS);
		vi.spyOn(UserGuildSettings, 'isGuildOrCategoryOrChannelMuted').mockReturnValue(false);
		vi.spyOn(MessagingMessage, 'messageMentionsCurrentUser').mockReturnValue(false);

		expect(shouldNotifyForMessage(guildChannel(), wireMessage())).toBe(false);
	});

	it('allows all messages when the community is set to all messages', () => {
		vi.spyOn(UserGuildSettings, 'resolvedMessageNotifications').mockReturnValue(MessageNotifications.ALL_MESSAGES);
		vi.spyOn(UserGuildSettings, 'isGuildOrCategoryOrChannelMuted').mockReturnValue(false);
		vi.spyOn(MessagingMessage, 'messageMentionsCurrentUser').mockReturnValue(false);

		expect(shouldNotifyForMessage(guildChannel(), wireMessage())).toBe(true);
	});

	it('blocks mention notifications for muted communities', () => {
		vi.spyOn(UserGuildSettings, 'resolvedMessageNotifications').mockReturnValue(MessageNotifications.ALL_MESSAGES);
		vi.spyOn(UserGuildSettings, 'isGuildOrCategoryOrChannelMuted').mockReturnValue(true);
		vi.spyOn(MessagingMessage, 'messageMentionsCurrentUser').mockReturnValue(true);

		expect(shouldNotifyForMessage(guildChannel(), wireMessage())).toBe(false);
	});

	it('blocks non-mention notifications for muted communities', () => {
		vi.spyOn(UserGuildSettings, 'resolvedMessageNotifications').mockReturnValue(MessageNotifications.ALL_MESSAGES);
		vi.spyOn(UserGuildSettings, 'isGuildOrCategoryOrChannelMuted').mockReturnValue(true);
		vi.spyOn(MessagingMessage, 'messageMentionsCurrentUser').mockReturnValue(false);

		expect(shouldNotifyForMessage(guildChannel(), wireMessage())).toBe(false);
	});

	it('treats unmuted private channels as mention-like for all messages', () => {
		vi.spyOn(UserGuildSettings, 'isGuildOrChannelMuted').mockReturnValue(false);
		vi.spyOn(MessagingMessage, 'messageMentionsCurrentUser').mockReturnValue(false);

		expect(
			isMessageMentionLike(
				guildChannel({
					guildId: null,
					isPrivate: () => true,
				}),
				wireMessage({guild_id: undefined}),
			),
		).toBe(true);
	});
});
