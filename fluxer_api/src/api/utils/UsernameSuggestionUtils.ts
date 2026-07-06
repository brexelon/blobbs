// SPDX-License-Identifier: AGPL-3.0-or-later

import {randomInt} from 'node:crypto';
import {UsernameType} from '@fluxer/schema/src/primitives/UserValidators';
import {transliterate as tr} from 'transliteration';

const MAX_USERNAME_LENGTH = 32;
const MAX_SUFFIX_ATTEMPTS = 20;
const MIN_SUFFIX_LENGTH = 1;
const MAX_SUFFIX_LENGTH = 4;
const SUFFIX_ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_INTERNAL = 'abcdefghijklmnopqrstuvwxyz0123456789._';

function isSeparator(char: string): boolean {
	return char === '_' || char === '.';
}

function canAppendToUsername(prefix: string, char: string): boolean {
	if (!isSeparator(char)) {
		return true;
	}
	const previous = prefix[prefix.length - 1];
	return previous !== undefined && !isSeparator(previous);
}

function pickRandomSuffixLength(base: string): number {
	const maxAllowed = Math.min(MAX_SUFFIX_LENGTH, MAX_USERNAME_LENGTH - base.length);
	if (maxAllowed < MIN_SUFFIX_LENGTH) {
		return 0;
	}
	return randomInt(MIN_SUFFIX_LENGTH, maxAllowed + 1);
}

function pickRandomChar(charset: string): string {
	return charset[randomInt(charset.length)]!;
}

function generateRandomSuffix(base: string): string | null {
	const length = pickRandomSuffixLength(base);
	if (length === 0) {
		return null;
	}
	let suffix = '';
	for (let index = 0; index < length; index++) {
		const isLast = index === length - 1;
		const prefix = `${base}${suffix}`;
		if (isLast) {
			const charset = canAppendToUsername(prefix, '_') ? `${SUFFIX_ALPHANUMERIC}._` : SUFFIX_ALPHANUMERIC;
			for (let attempt = 0; attempt < 8; attempt++) {
				const candidate = pickRandomChar(charset);
				if (canAppendToUsername(prefix, candidate)) {
					suffix += candidate;
					break;
				}
			}
			if (suffix.length !== index + 1) {
				return null;
			}
			continue;
		}
		const charset = canAppendToUsername(prefix, '_') ? SUFFIX_INTERNAL : SUFFIX_ALPHANUMERIC;
		for (let attempt = 0; attempt < 8; attempt++) {
			const candidate = pickRandomChar(charset);
			if (canAppendToUsername(prefix, candidate)) {
				suffix += candidate;
				break;
			}
		}
		if (suffix.length !== index + 1) {
			return null;
		}
	}
	return suffix;
}

function normalizeLeadingSeparators(value: string): string {
	return value.replace(/^[_.]+/g, '');
}

function normalizeTrailingSeparators(value: string): string {
	return value.replace(/([_.])\1+$/g, '$1');
}

function normalizeDerivedUsername(value: string): string {
	let sanitized = value;
	sanitized = sanitized.replace(/\s+/g, '_');
	sanitized = sanitized.replace(/-+/g, '_');
	sanitized = sanitized.replace(/_+/g, '_');
	sanitized = sanitized.replace(/\.+/g, '.');
	sanitized = sanitized.replace(/[^a-z0-9_.]/g, '');
	sanitized = normalizeLeadingSeparators(sanitized);
	sanitized = normalizeTrailingSeparators(sanitized);
	return sanitized;
}

function sanitizeDisplayName(globalName: string): string | null {
	const trimmed = globalName.trim();
	if (!trimmed) return null;
	let sanitized = tr(trimmed).toLowerCase();
	sanitized = normalizeDerivedUsername(sanitized);
	if (!sanitized) return null;
	if (sanitized.length > MAX_USERNAME_LENGTH) {
		sanitized = sanitized.substring(0, MAX_USERNAME_LENGTH);
		sanitized = normalizeLeadingSeparators(sanitized);
		sanitized = normalizeTrailingSeparators(sanitized);
	}
	if (!sanitized) return null;
	const validation = UsernameType.safeParse(sanitized);
	if (!validation.success) {
		return null;
	}
	return validation.data;
}

export function deriveUsernameFromDisplayName(globalName: string): string | null {
	return sanitizeDisplayName(globalName);
}

function buildUsernameWithSuffix(base: string, suffix: string): string | null {
	const maxBaseLength = MAX_USERNAME_LENGTH - suffix.length;
	if (maxBaseLength <= 0) {
		return null;
	}
	const truncatedBase = normalizeTrailingSeparators(
		normalizeLeadingSeparators(base.substring(0, maxBaseLength)),
	);
	if (!truncatedBase) {
		return null;
	}
	const candidate = `${truncatedBase}${suffix}`;
	const validation = UsernameType.safeParse(candidate);
	return validation.success ? validation.data : null;
}

export async function resolveAvailableUsername(
	base: string,
	isAvailable: (username: string) => Promise<boolean>,
): Promise<string | null> {
	if (await isAvailable(base)) {
		return base;
	}
	for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
		const suffix = generateRandomSuffix(base);
		if (!suffix) {
			continue;
		}
		const candidate = buildUsernameWithSuffix(base, suffix);
		if (candidate && (await isAvailable(candidate))) {
			return candidate;
		}
	}
	return null;
}

export async function generateUsernameSuggestions(
	globalName: string,
	isAvailable: (username: string) => Promise<boolean>,
): Promise<Array<string>> {
	const candidate = deriveUsernameFromDisplayName(globalName);
	if (!candidate) {
		return [];
	}
	const available = await resolveAvailableUsername(candidate, isAvailable);
	return available ? [available] : [];
}
