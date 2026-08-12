// SPDX-License-Identifier: AGPL-3.0-or-later

import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount, setUserACLs} from '../../auth/tests/AuthTestUtils';
import {createOAuth2Application} from '../../oauth/tests/OAuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';

interface UserMutationResponse {
	user: {
		id: string;
		username: string;
		discriminator: number;
		bot: boolean;
	};
}

describe('Admin change-username', () => {
	let harness: ApiTestHarness;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	beforeEach(async () => {
		await harness.reset();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});

	async function createAdmin() {
		const admin = await createTestAccount(harness);
		await setUserACLs(harness, admin, [AdminACLs.AUTHENTICATE, AdminACLs.WILDCARD]);
		return admin;
	}

	async function createBot(name: string) {
		const owner = await createTestAccount(harness);
		const application = await createOAuth2Application(harness, owner, {
			name,
			redirect_uris: ['https://example.com/callback'],
		});
		return application.bot;
	}

	function changeUsername(adminToken: string, body: Record<string, unknown>) {
		return createBuilder<UserMutationResponse>(harness, adminToken).post('/admin/users/change-username').body(body);
	}

	describe('people', () => {
		test('folds the new username to lower case', async () => {
			const admin = await createAdmin();
			const target = await createTestAccount(harness);
			const result = await changeUsername(admin.token, {user_id: target.userId, username: 'RenamedPerson'})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.username).toBe('renamedperson');
			expect(result.user.discriminator).toBe(0);
		});

		test('rejects a name with a space', async () => {
			const admin = await createAdmin();
			const target = await createTestAccount(harness);
			const {response} = await changeUsername(admin.token, {
				user_id: target.userId,
				username: 'renamed person',
			}).executeRaw();
			expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
		});

		test('refuses a username another person already holds', async () => {
			const admin = await createAdmin();
			const taken = await createTestAccount(harness, {username: 'takenname'});
			const target = await createTestAccount(harness);
			const {response} = await changeUsername(admin.token, {
				user_id: target.userId,
				username: taken.username,
			}).executeRaw();
			expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
		});
	});

	describe('applications', () => {
		test('keeps casing and spaces', async () => {
			const admin = await createAdmin();
			const bot = await createBot('Original Bot');
			const result = await changeUsername(admin.token, {user_id: bot.id, username: 'Renamed Bot'})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.username).toBe('Renamed Bot');
			expect(result.user.bot).toBe(true);
		});

		test('collapses runs of spaces', async () => {
			const admin = await createAdmin();
			const bot = await createBot('Original Bot');
			const result = await changeUsername(admin.token, {user_id: bot.id, username: 'Renamed   Bot'})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.username).toBe('Renamed Bot');
		});

		test('rejects characters the bot rules disallow', async () => {
			const admin = await createAdmin();
			const bot = await createBot('Original Bot');
			const {response} = await changeUsername(admin.token, {
				user_id: bot.id,
				username: 'renamed.bot',
			}).executeRaw();
			expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
		});

		test('allows a name a person already holds, since the namespaces are separate', async () => {
			const admin = await createAdmin();
			const person = await createTestAccount(harness, {username: 'sharedname'});
			const bot = await createBot('Original Bot');
			const result = await changeUsername(admin.token, {user_id: bot.id, username: person.username})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.username).toBe('sharedname');
		});

		test('honours a requested discriminator', async () => {
			const admin = await createAdmin();
			const bot = await createBot('Original Bot');
			const result = await changeUsername(admin.token, {
				user_id: bot.id,
				username: 'Renamed Bot',
				discriminator: 1234,
			})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.username).toBe('Renamed Bot');
			expect(result.user.discriminator).toBe(1234);
		});

		test('assigns a discriminator when none is requested', async () => {
			const admin = await createAdmin();
			const bot = await createBot('Original Bot');
			const result = await changeUsername(admin.token, {user_id: bot.id, username: 'Renamed Bot'})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.discriminator).toBeGreaterThan(0);
		});

		test('keeps its discriminator when only the casing changes', async () => {
			const admin = await createAdmin();
			const bot = await createBot('Original Bot');
			const result = await changeUsername(admin.token, {user_id: bot.id, username: 'ORIGINAL BOT'})
				.expect(HTTP_STATUS.OK)
				.execute();
			expect(result.user.username).toBe('ORIGINAL BOT');
			// The OAuth2 application response carries the discriminator as a string.
			expect(result.user.discriminator).toBe(Number(bot.discriminator));
		});

		test('refuses a username and discriminator another application already holds', async () => {
			const admin = await createAdmin();
			const existing = await createBot('Existing Bot');
			const bot = await createBot('Original Bot');
			const {response} = await changeUsername(admin.token, {
				user_id: bot.id,
				username: existing.username,
				discriminator: existing.discriminator,
			}).executeRaw();
			expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
		});
	});
});
