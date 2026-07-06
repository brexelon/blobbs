// SPDX-License-Identifier: AGPL-3.0-or-later

import Messages from '@app/features/messaging/state/MessagingMessages';
import Navigation from '@app/features/navigation/state/Navigation';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Notification from '@app/features/ui/state/Notification';
import Channels from '@app/features/channel/state/Channels';
import {hydrateUnresolvedUserPlaceholders} from '@app/features/user/state/UserPlaceholderHydration';
import {ME} from '@fluxer/constants/src/AppConstants';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import {reaction} from 'mobx';

const logger = new Logger('NavigationSideEffects');

class NavigationSideEffects {
	private lastChannelId: string | null = null;
	private lastMessageId: string | null = null;
	private disposer: (() => void) | null = null;

	initialize(): void {
		if (this.disposer) return;
		this.disposer = reaction(
			() => ({
				guildId: Navigation.guildId,
				channelId: Navigation.channelId,
				messageId: Navigation.messageId,
			}),
			({guildId, channelId, messageId}) => {
				this.handleRouteChange(guildId, channelId, messageId);
			},
			{fireImmediately: true},
		);
	}

	private handleRouteChange(guildId: string | null, channelId: string | null, messageId: string | null): void {
		const channelChanged = channelId !== this.lastChannelId;
		const messageChanged = messageId !== this.lastMessageId;
		if (!channelChanged && !messageChanged) return;
		this.lastChannelId = channelId;
		this.lastMessageId = messageId;
		if (!channelId) return;
		logger.debug(`Route change: guild=${guildId}, channel=${channelId}, message=${messageId}`);
		if (guildId === ME) {
			const channel = Channels.getChannel(channelId);
			if (channel && (channel.type === ChannelTypes.DM || channel.type === ChannelTypes.GROUP_DM)) {
				hydrateUnresolvedUserPlaceholders(channel.recipientIds);
			}
		}
		Messages.handleChannelSelect({
			guildId: guildId ?? undefined,
			channelId,
			messageId: messageId ?? undefined,
		});
		Notification.handleChannelSelect({channelId});
	}

	destroy(): void {
		this.disposer?.();
		this.disposer = null;
	}
}

export default new NavigationSideEffects();
