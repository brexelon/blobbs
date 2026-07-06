// SPDX-License-Identifier: AGPL-3.0-or-later

import {randomBytes} from 'node:crypto';

export interface DeletedUserIdentity {
	username: string;
	globalName: string;
}

export function generateDeletedUserIdentity(): DeletedUserIdentity {
	const suffix = randomBytes(6).toString('hex');
	const identity = `deleted_user_${suffix}`;
	return {username: identity, globalName: identity};
}

export async function allocateDeletedUserIdentity(
	isAvailable: (username: string) => Promise<boolean>,
): Promise<DeletedUserIdentity> {
	for (let attempt = 0; attempt < 10; attempt++) {
		const identity = generateDeletedUserIdentity();
		if (await isAvailable(identity.username)) {
			return identity;
		}
	}
	throw new Error('Failed to allocate deleted user identity');
}
