// SPDX-License-Identifier: AGPL-3.0-or-later

import {formatUserTag} from '@app/features/user/utils/UserTag';
import {describe, expect, it} from 'vitest';

describe('formatUserTag', () => {
	it('is the bare username for regular users, who carry discriminator 0', () => {
		expect(formatUserTag('weather', '0')).toBe('weather');
	});

	it('appends a padded discriminator for an application', () => {
		expect(formatUserTag('weather', '42')).toBe('weather#0042');
	});

	it('leaves an already four-digit discriminator alone', () => {
		expect(formatUserTag('weather', '1337')).toBe('weather#1337');
	});

	it('distinguishes two applications sharing a base name', () => {
		expect([formatUserTag('weather', '1'), formatUserTag('weather', '2')]).toEqual(['weather#0001', 'weather#0002']);
	});

	it('falls back to the bare username when the discriminator is missing or not a number', () => {
		expect(formatUserTag('weather', '')).toBe('weather');
		expect(formatUserTag('weather', 'nope')).toBe('weather');
		expect(formatUserTag('weather', null)).toBe('weather');
		expect(formatUserTag('weather', undefined)).toBe('weather');
	});
});
