// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {fetchUserMe, updateUserProfile} from './UserTestUtils';

async function runCaseUpdateTest(
	harness: ApiTestHarness,
	testFn: (params: {
		account: {
			userId: string;
			token: string;
			email: string;
			password: string;
		};
		initialUser: {
			username: string;
		};
	}) => Promise<void>,
): Promise<void> {
	const account = await createTestAccount(harness);
	const {json: initialUser} = await fetchUserMe(harness, account.token);
	await testFn({
		account,
		initialUser: {
			username: initialUser.username,
		},
	});
}

describe('User Username Case Update', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});
	afterEach(async () => {
		await harness?.shutdown();
	});
	test('re-sending existing username keeps username unchanged', async () => {
		await runCaseUpdateTest(harness, async ({account, initialUser}) => {
			const updated = await updateUserProfile(harness, account.token, {
				username: initialUser.username,
				password: account.password,
			});
			expect(updated.json.username).toBe(initialUser.username);
		});
	});
	test('changing username case normalizes to lowercase', async () => {
		await runCaseUpdateTest(harness, async ({account, initialUser}) => {
			const newUsername = initialUser.username.toUpperCase();
			const updated = await updateUserProfile(harness, account.token, {
				username: newUsername,
				password: account.password,
			});
			expect(updated.json.username).toBe(initialUser.username.toLowerCase());
		});
	});
	test('changing username completely works', async () => {
		await runCaseUpdateTest(harness, async ({account, initialUser}) => {
			const newUsername = `diff${initialUser.username.slice(0, Math.min(initialUser.username.length, 28))}`;
			const updated = await updateUserProfile(harness, account.token, {
				username: newUsername,
				password: account.password,
			});
			expect(updated.json.username).toBe(newUsername);
		});
	});
	test('no-op username stays unchanged', async () => {
		await runCaseUpdateTest(harness, async ({account, initialUser}) => {
			const updated = await updateUserProfile(harness, account.token, {
				username: initialUser.username,
				password: account.password,
			});
			expect(updated.json.username).toBe(initialUser.username);
		});
	});
});
