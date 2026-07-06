// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {generateDeletedUserIdentity} from '../DeletedUserIdentityUtils';
import {
	deriveUsernameFromDisplayName,
	generateUsernameSuggestions,
	resolveAvailableUsername,
} from '../UsernameSuggestionUtils';

describe('deriveUsernameFromDisplayName', () => {
	it('lowercases display names', () => {
		expect(deriveUsernameFromDisplayName('Ally')).toBe('ally');
	});

	it('replaces spaces with underscores', () => {
		expect(deriveUsernameFromDisplayName('Jane Doe')).toBe('jane_doe');
	});

	it('preserves periods', () => {
		expect(deriveUsernameFromDisplayName('Jane.Doe')).toBe('jane.doe');
	});

	it('replaces hyphens with underscores', () => {
		expect(deriveUsernameFromDisplayName('john-smith')).toBe('john_smith');
	});

	it('preserves a trailing period from the display name', () => {
		expect(deriveUsernameFromDisplayName('John.')).toBe('john.');
	});

	it('returns null for empty input', () => {
		expect(deriveUsernameFromDisplayName('   ')).toBeNull();
	});
});

describe('resolveAvailableUsername', () => {
	it('returns the base username when available', async () => {
		const result = await resolveAvailableUsername('ally', async () => true);
		expect(result).toBe('ally');
	});

	it('appends a variable-length suffix when the base username is taken', async () => {
		const taken = new Set(['ally']);
		const result = await resolveAvailableUsername('ally', async (username) => !taken.has(username));
		expect(result).toBeTruthy();
		expect(result!.startsWith('ally')).toBe(true);
		expect(result!.length).toBeGreaterThan('ally'.length);
		expect(result!.length).toBeLessThanOrEqual('ally'.length + 4);
		expect(result).toMatch(/^ally[a-z0-9._]+$/);
	});
});

describe('generateUsernameSuggestions', () => {
	it('returns an available lowercase suggestion derived from the display name', async () => {
		const suggestions = await generateUsernameSuggestions('Ally', async () => true);
		expect(suggestions).toEqual(['ally']);
	});

	it('returns a suffixed suggestion when the base username is taken', async () => {
		const taken = new Set(['ally']);
		const suggestions = await generateUsernameSuggestions('Ally', async (username) => !taken.has(username));
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatch(/^ally[a-z0-9._]+$/);
		expect(suggestions[0]!.length).toBeLessThanOrEqual('ally'.length + 4);
	});
});

describe('generateDeletedUserIdentity', () => {
	it('generates a lowercase deleted user identity', () => {
		const identity = generateDeletedUserIdentity();
		expect(identity.username).toBe(identity.globalName);
		expect(identity.username).toMatch(/^deleted_user_[0-9a-f]{12}$/);
	});
});
