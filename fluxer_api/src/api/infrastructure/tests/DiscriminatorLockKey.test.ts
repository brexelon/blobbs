// SPDX-License-Identifier: AGPL-3.0-or-later

import {validateLockKey} from '@pkgs/cache/src/CacheLockValidation';
import {describe, expect, it} from 'vitest';
import {discriminatorLockKey} from '../DiscriminatorService';

describe('discriminatorLockKey', () => {
	it('embeds a name the cache layer already accepts', () => {
		expect(discriminatorLockKey('weatherbot')).toBe('discrim-lock:weatherbot');
		expect(discriminatorLockKey('weather_bot_9')).toBe('discrim-lock:weather_bot_9');
	});

	it('hashes a name the cache layer would reject', () => {
		const key = discriminatorLockKey('weather bot');
		expect(key).not.toContain(' ');
		expect(key).toMatch(/^discrim-lock:h:[0-9a-f]{32}$/);
	});

	it('produces a key the cache layer accepts, whatever the username holds', () => {
		for (const username of ['weatherbot', 'weather bot', 'weather   bot', 'a b c', ' ']) {
			expect(() => validateLockKey(discriminatorLockKey(username))).not.toThrow();
		}
	});

	it('is stable and distinct per name', () => {
		expect(discriminatorLockKey('weather bot')).toBe(discriminatorLockKey('weather bot'));
		expect(discriminatorLockKey('weather bot')).not.toBe(discriminatorLockKey('weather bots'));
	});
});
