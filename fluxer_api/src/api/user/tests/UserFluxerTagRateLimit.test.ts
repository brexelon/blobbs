// SPDX-License-Identifier: AGPL-3.0-or-later

import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import {fetchUserMe, updateUserProfile} from './UserTestUtils';

describe('User FluxerTag rate limit', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});
	afterEach(async () => {
		await harness?.shutdown();
	});
	test('blocks the sixth username change within the cooldown window', async () => {
		const account = await createTestAccount(harness);
		const {json: me} = await fetchUserMe(harness, account.token);
		const usernameBase = me.username.slice(0, Math.min(me.username.length, 24));
		for (const suffix of ['rl_a', 'rl_b', 'rl_c', 'rl_d', 'rl_e']) {
			await updateUserProfile(harness, account.token, {
				username: `${usernameBase}${suffix}`,
				password: account.password,
			});
		}
		const {response, text} = await createBuilder(harness, account.token)
			.patch('/users/@me')
			.body({
				username: `${usernameBase}rl_f`,
				password: account.password,
			})
			.executeRaw();
		expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
		expect(text).toContain(ValidationErrorCodes.USERNAME_CHANGED_TOO_MANY_TIMES);
	});
});
