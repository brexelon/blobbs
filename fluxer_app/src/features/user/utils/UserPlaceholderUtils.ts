// SPDX-License-Identifier: AGPL-3.0-or-later

import type {User} from '@app/features/user/models/User';
import {DELETED_USER_GLOBAL_NAME, DELETED_USER_USERNAME} from '@fluxer/constants/src/UserConstants';
import type {UserPartial, User as WireUser} from '@fluxer/schema/src/domains/user/UserResponseSchemas';

export function isDeletedUserPlaceholderIdentity(username: string, globalName: string | null): boolean {
	return username === DELETED_USER_USERNAME && globalName === DELETED_USER_GLOBAL_NAME;
}

export function isDeletedUserPlaceholderWire(user: Pick<WireUser, 'username' | 'global_name'>): boolean {
	return isDeletedUserPlaceholderIdentity(user.username, user.global_name ?? null);
}

export function isDeletedUserPlaceholderUserPartial(user: Pick<UserPartial, 'username' | 'global_name'>): boolean {
	return isDeletedUserPlaceholderIdentity(user.username, user.global_name ?? null);
}

export function isDeletedUserPlaceholder(user: Pick<User, 'username' | 'globalName'>): boolean {
	return isDeletedUserPlaceholderIdentity(user.username, user.globalName);
}
