// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {deriveBotUsernameFromDisplayName} from './UsernameSuggestionUtils';

describe('deriveBotUsernameFromDisplayName', () => {
	it('keeps the application name verbatim when it is already a valid username', () => {
		expect(deriveBotUsernameFromDisplayName('Weather Bot')).toBe('Weather Bot');
		expect(deriveBotUsernameFromDisplayName('WeatherBot')).toBe('WeatherBot');
	});

	it('folds separators a bot username cannot hold into underscores', () => {
		expect(deriveBotUsernameFromDisplayName('weather-bot')).toBe('weather_bot');
		expect(deriveBotUsernameFromDisplayName('weather.bot')).toBe('weather_bot');
	});

	it('collapses repeated and surrounding whitespace', () => {
		expect(deriveBotUsernameFromDisplayName('  Weather   Bot  ')).toBe('Weather Bot');
	});

	it('drops characters outside the allowed set', () => {
		expect(deriveBotUsernameFromDisplayName('Weather! Bot?')).toBe('Weather Bot');
	});

	it('transliterates non-latin names', () => {
		expect(deriveBotUsernameFromDisplayName('Привет Бот')).toBe('Privet Bot');
	});

	it('does not leave a trailing space after truncating to the length limit', () => {
		const derived = deriveBotUsernameFromDisplayName(`${'a'.repeat(32)} Bot`);
		expect(derived).toBe('a'.repeat(32));
	});

	it('returns null when nothing usable survives', () => {
		expect(deriveBotUsernameFromDisplayName('   ')).toBeNull();
		expect(deriveBotUsernameFromDisplayName('!!!')).toBeNull();
	});

	it('returns null for a name that reduces to a reserved term', () => {
		expect(deriveBotUsernameFromDisplayName('System Message')).toBeNull();
	});
});
