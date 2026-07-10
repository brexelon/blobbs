// SPDX-License-Identifier: AGPL-3.0-or-later

import Accessibility from '@app/features/accessibility/state/Accessibility';
import UserSettings from '@app/features/user/state/UserSettings';
import {getCurrentLocale} from '@app/features/user/utils/LocaleUtils';
import {TimeFormatTypes} from '@fluxer/constants/src/UserConstants';
import {
	getFormattedCompactDateTime as getFormattedCompactDateTimeBase,
	getFormattedDateTime as getFormattedDateTimeBase,
	getFormattedDateTimeWithSeconds as getFormattedDateTimeWithSecondsBase,
	getFormattedFullDate as getFormattedFullDateBase,
	getFormattedShortDate as getFormattedShortDateBase,
	getFormattedTime as getFormattedTimeBase,
	getRelativeDateString as getRelativeDateStringBase,
} from '@fluxer/date_utils/src/DateFormatting';
import {localeUses12Hour} from '@fluxer/date_utils/src/DateHourCycle';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';

const TODAY_AT_DESCRIPTOR = msg({
	message: 'Today at {timeString}',
	comment:
		'Short label in the date and time formatting. Keep it concise. Preserve {timeString}; it is inserted by code.',
});
const YESTERDAY_AT_DESCRIPTOR = msg({
	message: 'Yesterday at {timeString}',
	comment:
		'Short label in the date and time formatting. Keep it concise. Preserve {timeString}; it is inserted by code.',
});

export function shouldUse12HourFormat(locale: string): boolean {
	const timeFormat = UserSettings.getTimeFormat();
	switch (timeFormat) {
		case TimeFormatTypes.TWELVE_HOUR:
			return true;
		case TimeFormatTypes.TWENTY_FOUR_HOUR:
			return false;
		default: {
			const useBrowserLocale = Accessibility.useBrowserLocaleForTimeFormat;
			const effectiveLocale = useBrowserLocale ? navigator.language : locale;
			return localeUses12Hour(effectiveLocale);
		}
	}
}

export function getRelativeDateString(timestamp: number | Date | string, i18n: I18n): string {
	const locale = getCurrentLocale();
	const hour12 = shouldUse12HourFormat(locale);
	const baseString = getRelativeDateStringBase(timestamp, locale, hour12);
	const date = new Date(
		typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : timestamp,
	);
	if (baseString.startsWith('Today at ')) {
		const timeString = getFormattedTimeBase(date, locale, hour12);
		return i18n._(TODAY_AT_DESCRIPTOR, {timeString});
	}
	if (baseString.startsWith('Yesterday at ')) {
		const timeString = getFormattedTimeBase(date, locale, hour12);
		return i18n._(YESTERDAY_AT_DESCRIPTOR, {timeString});
	}
	return baseString;
}

export function getFormattedDateTime(timestamp: number | Date | string): string {
	const locale = getCurrentLocale();
	const hour12 = shouldUse12HourFormat(locale);
	return getFormattedDateTimeBase(timestamp, locale, hour12);
}

export function getFormattedShortDate(timestamp: number | Date | string): string {
	const locale = getCurrentLocale();
	return getFormattedShortDateBase(timestamp, locale);
}

export function getFormattedTime(timestamp: number | Date | string): string {
	const locale = getCurrentLocale();
	const hour12 = shouldUse12HourFormat(locale);
	return getFormattedTimeBase(timestamp, locale, hour12);
}

export function getFormattedCompactDateTime(timestamp: number | Date | string): string {
	const locale = getCurrentLocale();
	const hour12 = shouldUse12HourFormat(locale);
	return getFormattedCompactDateTimeBase(timestamp, locale, hour12);
}

export function getFormattedFullDate(timestamp: number | Date | string): string {
	const locale = getCurrentLocale();
	return getFormattedFullDateBase(timestamp, locale);
}

export function getFormattedDateTimeWithSeconds(timestamp: number | Date | string): string {
	const locale = getCurrentLocale();
	const hour12 = shouldUse12HourFormat(locale);
	return getFormattedDateTimeWithSecondsBase(timestamp, locale, hour12);
}

/**
 * Compact, localized relative time in the "3h ago" / "1d ago" style (narrow
 * units). Picks the largest sensible unit and renders it via
 * Intl.RelativeTimeFormat; anything under ~45s collapses to "now".
 */
export function getShortRelativeTime(timestamp: number | Date | string): string {
	const then = new Date(timestamp).getTime();
	if (Number.isNaN(then)) {
		return '';
	}
	const locale = getCurrentLocale();
	const diffMs = then - Date.now();
	const absSec = Math.abs(diffMs) / 1000;
	if (absSec < 45) {
		return new Intl.RelativeTimeFormat(locale, {numeric: 'auto', style: 'narrow'}).format(0, 'second');
	}
	const rtf = new Intl.RelativeTimeFormat(locale, {numeric: 'always', style: 'narrow'});
	const minutes = diffMs / 60_000;
	if (Math.abs(minutes) < 45) {
		return rtf.format(Math.round(minutes), 'minute');
	}
	const hours = diffMs / 3_600_000;
	if (Math.abs(hours) < 22) {
		return rtf.format(Math.round(hours), 'hour');
	}
	const days = diffMs / 86_400_000;
	if (Math.abs(days) < 6) {
		return rtf.format(Math.round(days), 'day');
	}
	const weeks = days / 7;
	if (Math.abs(weeks) < 4) {
		return rtf.format(Math.round(weeks), 'week');
	}
	const months = days / 30;
	if (Math.abs(months) < 12) {
		return rtf.format(Math.round(months), 'month');
	}
	return rtf.format(Math.round(days / 365), 'year');
}
