// SPDX-License-Identifier: AGPL-3.0-or-later

import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {
	MAX_STRING_PROCESSING_LENGTH,
	normalizeString,
	normalizeWhitespace,
	removeStandaloneSurrogates,
	stripInvisibles,
	stripVariationSelectors,
	withOpenApiType,
	withStringLengthRangeValidation,
} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

const EMAIL_LOCAL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
export const USERNAME_CHARACTER_REGEX = /^[a-z0-9_.]+$/;
const USERNAME_INVALID_FORMAT_REGEX = /^[_.]|[_.]{2}/;
export const PHONE_E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function hasValidUsernameFormat(value: string): boolean {
	return USERNAME_CHARACTER_REGEX.test(value) && !USERNAME_INVALID_FORMAT_REGEX.test(value);
}

function sanitizeUsername(value: string): string {
	if (value.length > MAX_STRING_PROCESSING_LENGTH) {
		throw new Error(ValidationErrorCodes.STRING_LENGTH_INVALID);
	}
	let s = normalizeString(value);
	s = removeStandaloneSurrogates(s);
	s = stripInvisibles(s);
	s = stripVariationSelectors(s);
	s = normalizeWhitespace(s);
	return s;
}

export const EmailType = withOpenApiType(
	z
		.string()
		.transform(normalizeString)
		.pipe(
			withStringLengthRangeValidation(
				z.string().email(ValidationErrorCodes.INVALID_EMAIL_FORMAT),
				1,
				254,
				ValidationErrorCodes.EMAIL_LENGTH_INVALID,
			),
		)
		.refine((value: string) => {
			const atIndex = value.indexOf('@');
			if (atIndex === -1) return false;
			const local = value.slice(0, atIndex);
			return EMAIL_LOCAL_REGEX.test(local);
		}, ValidationErrorCodes.INVALID_EMAIL_LOCAL_PART),
	'EmailType',
);
export const UsernameType = withOpenApiType(
	z
		.string()
		.transform((value) => value.trim().toLowerCase())
		.pipe(withStringLengthRangeValidation(z.string(), 1, 32, ValidationErrorCodes.USERNAME_LENGTH_INVALID))
		.refine((value) => hasValidUsernameFormat(value), ValidationErrorCodes.USERNAME_INVALID_CHARACTERS)
		.refine((value) => {
			return value !== 'everyone' && value !== 'here';
		}, ValidationErrorCodes.USERNAME_RESERVED_VALUE)
		.refine((value) => {
			return !value.includes('fluxer') && !value.includes('system message');
		}, ValidationErrorCodes.USERNAME_CANNOT_CONTAIN_RESERVED_TERMS),
	'UsernameType',
);
export const GlobalNameType = z
	.string()
	.superRefine((value, ctx) => {
		if (value.length > MAX_STRING_PROCESSING_LENGTH) {
			ctx.addIssue({
				code: 'custom',
				message: ValidationErrorCodes.GLOBAL_NAME_LENGTH_INVALID,
				params: {min: 1, max: 32},
			});
			return z.NEVER;
		}
	})
	.transform(sanitizeUsername)
	.pipe(withStringLengthRangeValidation(z.string(), 1, 32, ValidationErrorCodes.GLOBAL_NAME_LENGTH_INVALID))
	.refine((value) => {
		const lowerValue = value.toLowerCase();
		return lowerValue !== 'everyone' && lowerValue !== 'here';
	}, ValidationErrorCodes.GLOBAL_NAME_RESERVED_VALUE)
	.refine((value) => {
		const lowerValue = value.toLowerCase();
		return !lowerValue.includes('system message');
	}, ValidationErrorCodes.GLOBAL_NAME_CANNOT_CONTAIN_RESERVED_TERMS);
export const PasswordType = withOpenApiType(
	z
		.string()
		.transform(normalizeString)
		.pipe(withStringLengthRangeValidation(z.string(), 8, 256, ValidationErrorCodes.PASSWORD_LENGTH_INVALID)),
	'PasswordType',
);
export const PhoneNumberType = withOpenApiType(
	z
		.string()
		.transform(normalizeString)
		.refine((value) => PHONE_E164_REGEX.test(value), ValidationErrorCodes.PHONE_NUMBER_INVALID_FORMAT),
	'PhoneNumberType',
);
export const WebhookNameType = z
	.string()
	.transform(normalizeString)
	.pipe(withStringLengthRangeValidation(z.string(), 1, 80, ValidationErrorCodes.WEBHOOK_NAME_LENGTH_INVALID));
