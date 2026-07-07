// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import Threads from '@app/features/channel/state/Threads';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import Permission from '@app/features/permissions/state/Permission';

interface ThreadMemberPayload {
	thread_id: string;
	guild_id?: string;
	user_id: string;
}

export function handleThreadMemberAdd(data: ThreadMemberPayload, _context: GatewayHandlerContext): void {
	if (data.user_id === Authentication.currentUserId) {
		Threads.join(data.thread_id);
		// Recompute permissions for the thread now that we are a member so the
		// composer and other permission-gated affordances become available.
		Permission.handleChannelUpdate(data.thread_id);
	}
}
