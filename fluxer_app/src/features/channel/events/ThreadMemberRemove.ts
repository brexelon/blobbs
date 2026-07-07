// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import Threads from '@app/features/channel/state/Threads';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';

interface ThreadMemberPayload {
	thread_id: string;
	guild_id?: string;
	user_id: string;
}

export function handleThreadMemberRemove(data: ThreadMemberPayload, _context: GatewayHandlerContext): void {
	if (data.user_id === Authentication.currentUserId) {
		Threads.leave(data.thread_id);
	}
}
