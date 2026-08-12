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

	it('accepts spaces, so an application keeps the name it was given', () => {
		expect(BotUsernameType.parse('Weather Bot')).toBe('Weather Bot');
	});

	it('collapses runs of spaces so near-identical names cannot coexist', () => {
		expect(BotUsernameType.parse('Weather   Bot')).toBe('Weather Bot');
	});

	it('trims surrounding whitespace', () => {
		expect(BotUsernameType.parse('  WeatherBot  ')).toBe('WeatherBot');
		expect(BotUsernameType.parse('  Weather Bot  ')).toBe('Weather Bot');
	});

	it('counts length after spacing is normalised', () => {
		// 33 characters as typed, 32 once the doubled space collapses.
		expect(BotUsernameType.parse(`${'a'.repeat(30)}  b`)).toBe(`${'a'.repeat(30)} b`);
		expect(BotUsernameType.safeParse(`${'a'.repeat(31)}  b`).success).toBe(false);
	});

	it('rejects whitespace that is not a plain space', () => {
		for (const value of ['Weather\tBot', 'Weather\nBot']) {
			expect(BotUsernameType.safeParse(value).success).toBe(false);
		}
	});

	it('rejects characters upstream does not allow', () => {
		for (const value of ['weather.bot', 'weather-bot', 'weather!']) {
			expect(BotUsernameType.safeParse(value).success).toBe(false);
		}
	});

	it('applies reserved-word rules regardless of case', () => {
		for (const value of ['Everyone', 'HERE', 'MyFluxerBot', 'FLUXER_bot']) {
			expect(BotUsernameType.safeParse(value).success).toBe(false);
		}
	});

	it("rejects 'system message', which spaces made reachable", () => {
		expect(BotUsernameType.safeParse('System Message').success).toBe(false);
		expect(BotUsernameType.safeParse('A System Message Bot').success).toBe(false);
		// The underscored form is a different string and stays allowed, as before.
		expect(BotUsernameType.safeParse('System_Message').success).toBe(true);
	});

	it('rejects empty and over-length names', () => {
		expect(BotUsernameType.safeParse('').success).toBe(false);
		expect(BotUsernameType.safeParse('a'.repeat(33)).success).toBe(false);
		expect(BotUsernameType.safeParse('a'.repeat(32)).success).toBe(true);
	});
});
