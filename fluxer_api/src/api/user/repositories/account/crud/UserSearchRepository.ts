// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserID} from '../../../../BrandedTypes';
import {Logger} from '../../../../Logger';
import type {User} from '../../../../models/User';
import {getUserSearchService} from '../../../../SearchFactory';

export class UserSearchRepository {
	async indexUser(user: User): Promise<void> {
		const userSearchService = getUserSearchService();
		if (userSearchService && 'indexUser' in userSearchService) {
			await userSearchService.indexUser(user).catch((error) => {
				Logger.error({userId: user.id, error}, 'Failed to index user in search');
			});
		}
	}

	async updateUser(user: User): Promise<void> {
		const userSearchService = getUserSearchService();
		if (userSearchService && 'updateUser' in userSearchService) {
			await userSearchService.updateUser(user).catch((error) => {
				Logger.error({userId: user.id, error}, 'Failed to update user in search');
			});
		}
	}

	async deleteUser(userId: UserID): Promise<void> {
		const userSearchService = getUserSearchService();
		if (userSearchService && 'deleteUser' in userSearchService) {
			await userSearchService.deleteUser(userId).catch((error) => {
				Logger.error({userId, error}, 'Failed to delete user from search');
			});
		}
	}
}
