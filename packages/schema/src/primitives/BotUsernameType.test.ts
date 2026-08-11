// SPDX-License-Identifier: AGPL-3.0-or-later

import {BotUsernameType, UsernameType} from '@fluxer/schema/src/primitives/UserValidators';
import {describe, expect, it} from 'vitest';

describe('BotUsernameType', () => {
	it('keeps the casing it was given, unlike a regular username', () => {
		expect(BotUsernameType.parse('WeatherBot')).toBe('WeatherBot');
		expect(UsernameType.parse('WeatherBot')).toBe('weatherbot');
	});

	it('accepts letters in either case, digits and underscores', () => {
		expect(BotUsernameType.parse('Weather_Bot_9')).toBe('Weather_Bot_9');
	});

	it('trims surrounding whitespace', () => {
		expect(BotUsernameType.parse('  WeatherBot  ')).toBe('WeatherBot');
	});

	it('rejects characters upstream does not allow', () => {
		for (const value of ['Weather Bot', 'weather.bot', 'weather-bot', 'weather!']) {
			expect(BotUsernameType.safeParse(value).success).toBe(false);
		}
	});

	it('applies reserved-word rules regardless of case', () => {
		for (const value of ['Everyone', 'HERE', 'MyFluxerBot', 'FLUXER_bot']) {
			expect(BotUsernameType.safeParse(value).success).toBe(false);
		}
	});

	it("does not catch 'system message', which no username can contain anyway", () => {
		// The reserved term has a space in it and the character set has none, so this
		// refine is vacuous here. Kept to stay in step with upstream's validator.
		expect(BotUsernameType.safeParse('System_Message').success).toBe(true);
	});

	it('rejects empty and over-length names', () => {
		expect(BotUsernameType.safeParse('').success).toBe(false);
		expect(BotUsernameType.safeParse('a'.repeat(33)).success).toBe(false);
		expect(BotUsernameType.safeParse('a'.repeat(32)).success).toBe(true);
	});
});
