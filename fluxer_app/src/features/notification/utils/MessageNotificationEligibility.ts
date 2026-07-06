// SPDX-License-Identifier: AGPL-3.0-or-later

import {messageMentionsCurrentUser} from '@app/features/messaging/models/MessagingMessage';
import UserGuildSettings from '@app/features/user/state/UserGuildSettings';
import {MessageNotifications} from '@fluxer/constants/src/NotificationConstants';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

export type MessageNotificationChannel = {
	id: string;
	guildId?: string | null;
	parentId?: string | null;
	type: number;
	isPrivate(): boolean;
};

export function isMessageMentionLike(channel: MessageNotificationChannel, message: WireMessage): boolean {
	if (messageMentionsCurrentUser(message)) {
		return true;
	}
	if (channel.isPrivate()) {
		return !UserGuildSettings.isGuildOrChannelMuted(null, channel.id);
	}
	return false;
}

export function shouldNotifyForMessage(channel: MessageNotificationChannel, message: WireMessage): boolean {
	const channelContext = {
		id: channel.id,
		guildId: channel.guildId ?? undefined,
		parentId: channel.parentId ?? undefined,
		type: channel.type,
	};
	if (UserGuildSettings.isGuildOrCategoryOrChannelMuted(channel.guildId ?? null, channel.id)) {
		return false;
	}
	const level = UserGuildSettings.resolvedMessageNotifications(channelContext);
	if (level === MessageNotifications.NO_MESSAGES) {
		return false;
	}
	const mentionLike = isMessageMentionLike(channel, message);
	if (level === MessageNotifications.ONLY_MENTIONS) {
		return mentionLike;
	}
	return true;
}
