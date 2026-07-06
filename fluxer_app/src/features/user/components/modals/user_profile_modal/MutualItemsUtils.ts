// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import * as ChannelUtils from '@app/features/channel/utils/ChannelUtils';
import type {Guild} from '@app/features/guild/models/Guild';
import Guilds from '@app/features/guild/state/Guilds';
import {User} from '@app/features/user/models/User';
import type {ProfileMutualGuild} from '@app/features/user/models/Profile';
import type {UserPartial} from '@fluxer/schema/src/domains/user/UserResponseSchemas';

export type MutualCommunityDisplayItem = {
	guild: Guild;
	nick: string | null;
};

export type MutualPlaceListItem =
	| {kind: 'group'; group: Channel; sortName: string}
	| {kind: 'community'; community: MutualCommunityDisplayItem; sortName: string};

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right, undefined, {sensitivity: 'base'});
}

export function getMutualGroupChannels(userId: string): Array<Channel> {
	return Channels.dmChannels.filter((channel) => channel.isGroupDM() && channel.recipientIds.includes(userId));
}

export function getMutualCommunityDisplayItems(
	mutualGuilds: ReadonlyArray<ProfileMutualGuild>,
): Array<MutualCommunityDisplayItem> {
	return mutualGuilds
		.map((mutualGuild) => {
			const guild = Guilds.getGuild(mutualGuild.id);
			if (!guild) {
				return null;
			}
			return {guild, nick: mutualGuild.nick};
		})
		.filter((item): item is MutualCommunityDisplayItem => item !== null);
}

export function getSortedMutualFriends(mutualFriends: ReadonlyArray<UserPartial>): Array<User> {
	return mutualFriends
		.map((friend) => new User(friend))
		.sort((left, right) => compareStrings(left.username, right.username));
}

export function getSortedMutualCommunityDisplayItems(
	mutualGuilds: ReadonlyArray<ProfileMutualGuild>,
): Array<MutualCommunityDisplayItem> {
	return getMutualCommunityDisplayItems(mutualGuilds).sort((left, right) => compareStrings(left.guild.name, right.guild.name));
}

export function getSortedMutualGroupChannels(userId: string): Array<Channel> {
	return getMutualGroupChannels(userId).sort((left, right) =>
		compareStrings(ChannelUtils.getDMDisplayName(left), ChannelUtils.getDMDisplayName(right)),
	);
}

export function getSortedMutualPlaceItems(
	sortedGroups: ReadonlyArray<Channel>,
	sortedCommunities: ReadonlyArray<MutualCommunityDisplayItem>,
): Array<MutualPlaceListItem> {
	return [
		...sortedGroups.map((group) => ({
			kind: 'group' as const,
			group,
			sortName: ChannelUtils.getDMDisplayName(group),
		})),
		...sortedCommunities.map((community) => ({
			kind: 'community' as const,
			community,
			sortName: community.guild.name,
		})),
	].sort((left, right) => compareStrings(left.sortName, right.sortName));
}
