// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import Threads from '@app/features/channel/state/Threads';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

interface ThreadDeletePayload {
	id: string;
	guild_id?: string;
	parent_id?: string | null;
}

export function handleThreadDelete(data: ThreadDeletePayload, _context: GatewayHandlerContext): void {
	Threads.leave(data.id);
	Channels.handleChannelDelete({channel: data as Channel});
}
