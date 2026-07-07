// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

export function handleThreadCreate(data: Channel, _context: GatewayHandlerContext): void {
	// Seed the thread channel so thread boxes, lists, and (once joined) the sidebar
	// can resolve it. Membership is tracked separately via THREAD_MEMBER_ADD.
	Channels.handleChannelCreate({channel: data});
}
