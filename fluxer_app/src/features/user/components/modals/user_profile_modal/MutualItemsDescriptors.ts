// SPDX-License-Identifier: AGPL-3.0-or-later

import type {MessageDescriptor} from '@lingui/core';
import {msg} from '@lingui/core/macro';

interface MutualItemsDescriptorOptions {
	mutualCommunitiesCount: number;
	mutualGroupsCount: number;
	includeCount: boolean;
}

export const MUTUAL_COMMUNITIES_GROUPS_DESCRIPTOR = msg({
	message: 'Mutual places',
	comment:
		'Short label for a combined list of mutual group DMs and mutual communities. Translate "places" as the most accurate local word for shared communities and groups.',
});
export const MUTUAL_COMMUNITIES_GROUPS_COUNT_DESCRIPTOR = msg({
	message: 'Mutual places ({count})',
	comment:
		'Short tab or button label for a combined list of mutual group DMs and mutual communities. Preserve {count}; it is inserted by code. Translate "places" as the most accurate local word for shared communities and groups.',
});
export const MUTUAL_COMMUNITIES_DESCRIPTOR = msg({
	message: 'Mutual communities',
	comment: 'Short label for a list of mutual communities in the user profile modal.',
});
export const MUTUAL_COMMUNITIES_COUNT_DESCRIPTOR = msg({
	message: 'Mutual communities ({count})',
	comment:
		'Short tab or button label for a list of mutual communities in the user profile modal. Preserve {count}; it is inserted by code.',
});
export const MUTUAL_GROUPS_DESCRIPTOR = msg({
	message: 'Mutual groups',
	comment: 'Short label for a list of mutual group DMs in the user profile modal.',
});
export const MUTUAL_GROUPS_COUNT_DESCRIPTOR = msg({
	message: 'Mutual groups ({count})',
	comment:
		'Short tab or button label for a list of mutual group DMs in the user profile modal. Preserve {count}; it is inserted by code.',
});
export const MUTUAL_FRIENDS_COUNT_DESCRIPTOR = msg({
	message: 'Mutual friends ({count})',
	comment:
		'Short tab or button label for a list of mutual friends in the user profile modal. Preserve {count}; it is inserted by code.',
});
export const MUTUAL_FRIENDS_COMPACT_DESCRIPTOR = msg({
	message: '{count, plural, one {# mutual friend} other {# mutual friends}}',
	comment:
		'Compact label for mutual friends count in profile tabs and the user profile card popout. Preserve {count}; it is inserted by code.',
});
export const MUTUAL_COMMUNITIES_COMPACT_DESCRIPTOR = msg({
	message: '{count, plural, one {# mutual community} other {# mutual communities}}',
	comment:
		'Compact label for mutual communities count in profile tabs and the user profile card popout. Preserve {count}; it is inserted by code.',
});
export const MUTUAL_GROUPS_COMPACT_DESCRIPTOR = msg({
	message: '{count, plural, one {# mutual group} other {# mutual groups}}',
	comment:
		'Compact label for mutual groups count in profile tabs and the user profile card popout. Preserve {count}; it is inserted by code.',
});
export const MUTUAL_PLACES_COMPACT_DESCRIPTOR = msg({
	message: '{count, plural, one {# mutual place} other {# mutual places}}',
	comment:
		'Compact label for combined mutual groups and communities count in profile tabs and the user profile card popout. Preserve {count}; it is inserted by code.',
});
export const NO_MUTUAL_FRIENDS_TAB_DESCRIPTOR = msg({
	message: 'No mutual friends',
	comment: 'Profile tab label when the user has no mutual friends.',
});
export const NO_MUTUAL_COMMUNITIES_TAB_DESCRIPTOR = msg({
	message: 'No mutual communities',
	comment: 'Profile tab label when the user has no mutual communities.',
});
export const NO_MUTUAL_GROUPS_TAB_DESCRIPTOR = msg({
	message: 'No mutual groups',
	comment: 'Profile tab label when the user has no mutual groups.',
});
export const NO_MUTUAL_PLACES_TAB_DESCRIPTOR = msg({
	message: 'No mutual places',
	comment: 'Profile tab label when the user has no mutual groups or communities.',
});
export const NO_MUTUAL_COMMUNITIES_FOUND_DESCRIPTOR = msg({
	message: 'No mutual communities found.',
	comment: 'Empty state in the user profile modal when no shared communities are available.',
});

export function getMutualItemsDescriptor({
	mutualCommunitiesCount,
	mutualGroupsCount,
	includeCount,
}: MutualItemsDescriptorOptions): MessageDescriptor {
	if (mutualCommunitiesCount > 0 && mutualGroupsCount > 0) {
		return includeCount ? MUTUAL_COMMUNITIES_GROUPS_COUNT_DESCRIPTOR : MUTUAL_COMMUNITIES_GROUPS_DESCRIPTOR;
	}
	if (mutualGroupsCount > 0) {
		return includeCount ? MUTUAL_GROUPS_COUNT_DESCRIPTOR : MUTUAL_GROUPS_DESCRIPTOR;
	}
	return includeCount ? MUTUAL_COMMUNITIES_COUNT_DESCRIPTOR : MUTUAL_COMMUNITIES_DESCRIPTOR;
}

export function getMutualItemsCompactDescriptor({
	mutualCommunitiesCount,
	mutualGroupsCount,
}: Omit<MutualItemsDescriptorOptions, 'includeCount'>): MessageDescriptor {
	if (mutualCommunitiesCount > 0 && mutualGroupsCount > 0) {
		return MUTUAL_PLACES_COMPACT_DESCRIPTOR;
	}
	if (mutualGroupsCount > 0) {
		return MUTUAL_GROUPS_COMPACT_DESCRIPTOR;
	}
	return MUTUAL_COMMUNITIES_COMPACT_DESCRIPTOR;
}

export function getMutualFriendsTabLabelDescriptor(count: number): MessageDescriptor {
	return count === 0 ? NO_MUTUAL_FRIENDS_TAB_DESCRIPTOR : MUTUAL_FRIENDS_COMPACT_DESCRIPTOR;
}

function getMutualItemsEmptyTabLabelDescriptor({
	mutualCommunitiesCount,
	mutualGroupsCount,
}: Omit<MutualItemsDescriptorOptions, 'includeCount'>): MessageDescriptor {
	if (mutualCommunitiesCount > 0 && mutualGroupsCount > 0) {
		return NO_MUTUAL_PLACES_TAB_DESCRIPTOR;
	}
	if (mutualGroupsCount > 0) {
		return NO_MUTUAL_GROUPS_TAB_DESCRIPTOR;
	}
	return NO_MUTUAL_COMMUNITIES_TAB_DESCRIPTOR;
}

export function getMutualItemsTabLabelDescriptor({
	mutualCommunitiesCount,
	mutualGroupsCount,
	count,
}: Omit<MutualItemsDescriptorOptions, 'includeCount'> & {count: number}): MessageDescriptor {
	if (count === 0) {
		return getMutualItemsEmptyTabLabelDescriptor({mutualCommunitiesCount, mutualGroupsCount});
	}
	return getMutualItemsCompactDescriptor({mutualCommunitiesCount, mutualGroupsCount});
}
