// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import Users from '@app/features/user/state/Users';
import {isDeletedUserPlaceholder} from '@app/features/user/utils/UserPlaceholderUtils';

const logger = new Logger('UserPlaceholderHydration');
const inFlight = new Set<string>();
const queued = new Set<string>();
let flushScheduled = false;

export function queueUserPlaceholderHydration(userId: string): void {
	if (inFlight.has(userId) || queued.has(userId)) {
		return;
	}
	const existing = Users.getUser(userId);
	if (existing && !isDeletedUserPlaceholder(existing)) {
		return;
	}
	queued.add(userId);
	scheduleFlush();
}

export function hydrateUnresolvedUserPlaceholders(userIds: Iterable<string>): void {
	for (const userId of userIds) {
		queueUserPlaceholderHydration(userId);
	}
}

function scheduleFlush(): void {
	if (flushScheduled) {
		return;
	}
	flushScheduled = true;
	queueMicrotask(() => {
		flushScheduled = false;
		void flushQueue();
	});
}

async function flushQueue(): Promise<void> {
	const userIds = Array.from(queued);
	queued.clear();
	for (const userId of userIds) {
		if (inFlight.has(userId)) {
			continue;
		}
		const existing = Users.getUser(userId);
		if (existing && !isDeletedUserPlaceholder(existing)) {
			continue;
		}
		inFlight.add(userId);
		try {
			await UserProfileCommands.fetch(userId);
		} catch (error) {
			logger.warn(`Failed to hydrate placeholder user ${userId}`, error);
		} finally {
			inFlight.delete(userId);
		}
	}
}
