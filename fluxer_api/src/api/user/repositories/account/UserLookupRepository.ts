// SPDX-License-Identifier: AGPL-3.0-or-later

import {getSameIpDecisionKey, normalizeIpString} from '@fluxer/ip_utils/src/IpAddress';
import type {UserID} from '../../../BrandedTypes';
import {fetchMany, fetchOne} from '../../../database/CassandraQueryExecution';
import type {
	UserByLastActiveIpRow,
	UserByLastActiveIpTrustKeyRow,
	UserByStripeCustomerIdRow,
	UserByStripeSubscriptionIdRow,
	UserByUsernameV2Row,
} from '../../../database/types/UserTypes';
import type {User} from '../../../models/User';
import {
	UserByLastActiveIp,
	UserByLastActiveIpTrustKey,
	UserByStripeCustomerId,
	UserByStripeSubscriptionId,
	UserByUsernameV2,
} from '../../../Tables';
import type {UserEmailOwnershipRepository} from './crud/UserEmailOwnershipRepository';

const FETCH_USER_ID_BY_STRIPE_CUSTOMER_ID_QUERY = UserByStripeCustomerId.select({
	columns: ['user_id'],
	where: UserByStripeCustomerId.where.eq('stripe_customer_id'),
	limit: 1,
});
const FETCH_USER_ID_BY_STRIPE_SUBSCRIPTION_ID_QUERY = UserByStripeSubscriptionId.select({
	columns: ['user_id'],
	where: UserByStripeSubscriptionId.where.eq('stripe_subscription_id'),
	limit: 1,
});
const FETCH_USER_ID_BY_USERNAME_QUERY = UserByUsernameV2.select({
	columns: ['user_id'],
	where: UserByUsernameV2.where.eq('username'),
	limit: 1,
});
const FETCH_USER_IDS_BY_LAST_ACTIVE_IP_QUERY = UserByLastActiveIp.select({
	columns: ['user_id'],
	where: UserByLastActiveIp.where.eq('last_active_ip'),
});
const FETCH_USER_IDS_BY_LAST_ACTIVE_IP_TRUST_KEY_QUERY = UserByLastActiveIpTrustKey.select({
	columns: ['user_id'],
	where: UserByLastActiveIpTrustKey.where.eq('last_active_ip_trust_key'),
});

export class UserLookupRepository {
	constructor(
		private findUniqueUser: (userId: UserID) => Promise<User | null>,
		private readonly emailOwnershipRepo: UserEmailOwnershipRepository,
	) {}

	async findByEmail(email: string): Promise<User | null> {
		const ownerId = await this.emailOwnershipRepo.findOwnerId(email);
		if (!ownerId) return null;
		return await this.findUniqueUser(ownerId);
	}

	async findByStripeCustomerId(stripeCustomerId: string): Promise<User | null> {
		const result = await fetchOne<Pick<UserByStripeCustomerIdRow, 'user_id'>>(
			FETCH_USER_ID_BY_STRIPE_CUSTOMER_ID_QUERY.bind({stripe_customer_id: stripeCustomerId}),
		);
		if (!result) return null;
		return await this.findUniqueUser(result.user_id);
	}

	async findByStripeSubscriptionId(stripeSubscriptionId: string): Promise<User | null> {
		const result = await fetchOne<Pick<UserByStripeSubscriptionIdRow, 'user_id'>>(
			FETCH_USER_ID_BY_STRIPE_SUBSCRIPTION_ID_QUERY.bind({stripe_subscription_id: stripeSubscriptionId}),
		);
		if (!result) return null;
		return await this.findUniqueUser(result.user_id);
	}

	async findByUsername(username: string): Promise<User | null> {
		const result = await fetchOne<Pick<UserByUsernameV2Row, 'user_id'>>(
			FETCH_USER_ID_BY_USERNAME_QUERY.bind({username: username.toLowerCase()}),
		);
		if (!result) return null;
		return await this.findUniqueUser(result.user_id);
	}

	async isUsernameAvailable(username: string): Promise<boolean> {
		const result = await fetchOne<Pick<UserByUsernameV2Row, 'user_id'>>(
			FETCH_USER_ID_BY_USERNAME_QUERY.bind({username: username.toLowerCase()}),
		);
		return result === null;
	}

	async listUserIdsByLastActiveIp(
		lastActiveIp: string,
		limit: number,
		offset: number,
	): Promise<{
		userIds: Array<UserID>;
		total: number;
	}> {
		const normalizedIp = normalizeIpString(lastActiveIp);
		const trustKey = getSameIpDecisionKey(normalizedIp);
		const userIds: Array<UserID> = [];
		const seen = new Set<string>();
		const trustKeyRows =
			trustKey == null
				? []
				: await fetchMany<Pick<UserByLastActiveIpTrustKeyRow, 'user_id'>>(
						FETCH_USER_IDS_BY_LAST_ACTIVE_IP_TRUST_KEY_QUERY.bind({last_active_ip_trust_key: trustKey}),
					);
		for (const row of trustKeyRows) {
			const key = row.user_id.toString();
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			userIds.push(row.user_id);
		}
		if (trustKey == null || trustKey !== normalizedIp || userIds.length === 0) {
			const exactRows = await fetchMany<Pick<UserByLastActiveIpRow, 'user_id'>>(
				FETCH_USER_IDS_BY_LAST_ACTIVE_IP_QUERY.bind({last_active_ip: normalizedIp}),
			);
			for (const row of exactRows) {
				const key = row.user_id.toString();
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				userIds.push(row.user_id);
			}
		}
		const total = userIds.length;
		if (total === 0 || offset >= total) {
			return {userIds: [], total};
		}
		return {
			userIds: userIds.slice(offset, offset + limit),
			total,
		};
	}
}
