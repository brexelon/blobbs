// SPDX-License-Identifier: AGPL-3.0-or-later

import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {UsernameType} from '@fluxer/schema/src/primitives/UserValidators';

const WORDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'words');
const scales = readFileSync(resolve(WORDS_DIR, 'scales.txt'), 'utf-8').trim().split('\n').filter(Boolean);
const tails = readFileSync(resolve(WORDS_DIR, 'tails.txt'), 'utf-8').trim().split('\n').filter(Boolean);

function pickRandom(words: Array<string>): string {
	return words[randomInt(words.length)];
}

export function generateRandomUsername(): string {
	const MAX_LENGTH = 32;
	const MAX_ATTEMPTS = 100;
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		const username = pickRandom(scales) + pickRandom(tails);
		if (username.length <= MAX_LENGTH && UsernameType.safeParse(username).success) {
			return username;
		}
	}
	for (const tail of tails) {
		if (tail.length <= MAX_LENGTH && UsernameType.safeParse(tail).success) {
			return tail;
		}
	}
	return 'botuser';
}
