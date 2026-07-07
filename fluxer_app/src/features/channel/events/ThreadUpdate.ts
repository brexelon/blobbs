// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

export function handleThreadUpdate(data: Channel, _context: GatewayHandlerContext): void {
	Channels.handleChannelCreate({channel: data});
}
