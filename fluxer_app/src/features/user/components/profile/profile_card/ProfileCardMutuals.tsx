// SPDX-License-Identifier: AGPL-3.0-or-later

import {GroupDMAvatar} from '@app/features/app/components/shared/GroupDMAvatar';
import {GuildIcon} from '@app/features/guild/components/popouts/GuildIcon';
import {UserContextMenu} from '@app/features/ui/action_menu/UserContextMenu';
import {AvatarStack} from '@app/features/ui/avatars/AvatarStack';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {
	getMutualItemsCompactDescriptor,
	MUTUAL_FRIENDS_COMPACT_DESCRIPTOR,
} from '@app/features/user/components/modals/user_profile_modal/MutualItemsDescriptors';
import {
	getSortedMutualCommunityDisplayItems,
	getSortedMutualFriends,
	getSortedMutualGroupChannels,
	getSortedMutualPlaceItems,
} from '@app/features/user/components/modals/user_profile_modal/MutualItemsUtils';
import type {ProfileTab} from '@app/features/user/components/modals/user_profile_modal/UserProfileModalShared';
import styles from '@app/features/user/components/profile/profile_card/ProfileCardMutuals.module.css';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import type {Profile} from '@app/features/user/models/Profile';
import type {User} from '@app/features/user/models/User';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import clsx from 'clsx';
import type React from 'react';
import {useCallback, useMemo} from 'react';

interface ProfileCardMutualsProps {
	profile: Profile;
	user: User;
	guildId?: string;
	onClose?: () => void;
}

export const ProfileCardMutuals: React.FC<ProfileCardMutualsProps> = observer(({profile, user, guildId, onClose}) => {
	const {i18n} = useLingui();
	const sortedFriends = useMemo(
		() => getSortedMutualFriends(profile.mutualFriends ?? []),
		[profile.mutualFriends],
	);
	const sortedCommunities = useMemo(
		() => getSortedMutualCommunityDisplayItems(profile.mutualGuilds ?? []),
		[profile.mutualGuilds],
	);
	const sortedGroups = useMemo(() => getSortedMutualGroupChannels(user.id), [user.id]);
	const sortedPlaces = useMemo(
		() => getSortedMutualPlaceItems(sortedGroups, sortedCommunities),
		[sortedCommunities, sortedGroups],
	);
	const mutualFriendsCount = sortedFriends.length;
	const mutualCommunitiesCount = sortedCommunities.length;
	const mutualGroupsCount = sortedGroups.length;
	const mutualPlacesCount = mutualCommunitiesCount + mutualGroupsCount;
	const hasMutualFriends = mutualFriendsCount > 0;
	const hasMutualPlaces = mutualPlacesCount > 0;
	const openProfileTab = useCallback(
		(tab: ProfileTab) => {
			onClose?.();
			UserProfileCommands.openUserProfile(user.id, profile.guildId ?? guildId, undefined, tab);
		},
		[guildId, onClose, profile.guildId, user.id],
	);
	const handleFriendContextMenu = useCallback(
		(event: React.MouseEvent, friend: User) => {
			event.preventDefault();
			event.stopPropagation();
			ContextMenuCommands.openFromEvent(event, ({onClose: closeMenu}) => (
				<UserContextMenu
					user={friend}
					guildId={profile.guildId ?? guildId}
					onClose={closeMenu}
					data-flx="user.profile.profile-card.profile-card-mutuals.friend-context-menu"
				/>
			));
		},
		[guildId, profile.guildId],
	);
	if (!hasMutualFriends && !hasMutualPlaces) {
		return null;
	}
	const placesCount =
		mutualCommunitiesCount > 0 && mutualGroupsCount > 0
			? mutualPlacesCount
			: mutualGroupsCount > 0
				? mutualGroupsCount
				: mutualCommunitiesCount;
	const placesLabel = i18n._(
		getMutualItemsCompactDescriptor({
			mutualCommunitiesCount,
			mutualGroupsCount,
		}),
		{count: placesCount},
	);
	const friendsLabel = i18n._(MUTUAL_FRIENDS_COMPACT_DESCRIPTOR, {count: mutualFriendsCount});
	const showFriendAvatars = hasMutualFriends;
	const showPlaceIcons = hasMutualPlaces && !hasMutualFriends;
	const placeIconItems = sortedPlaces.slice(0, 3);
	const friendAvatarMaxVisible = Math.min(3, mutualFriendsCount);
	const placeIconMaxVisible = Math.min(3, placeIconItems.length);
	const stackFriendAvatars = mutualFriendsCount > 1;
	const stackPlaceIcons = placeIconItems.length > 1;
	const showBothMutuals = hasMutualFriends && hasMutualPlaces;
	const mutualIconSize = showBothMutuals ? 16 : 20;
	const iconStackClassName = clsx(
		styles.iconStack,
		showBothMutuals && styles.iconStackCompact,
		stackFriendAvatars && styles.iconStackStacked,
	);
	const placeIconStackClassName = clsx(styles.iconStack, stackPlaceIcons && styles.iconStackStacked);
	return (
		<div
			className={clsx(styles.mutualsRow, showBothMutuals && styles.mutualsRowCompact)}
			data-flx="user.profile.profile-card.profile-card-mutuals.mutuals-row"
		>
			{showFriendAvatars && (
				<AvatarStack
					className={iconStackClassName}
					size={mutualIconSize}
					maxVisible={friendAvatarMaxVisible}
					overlap={stackFriendAvatars ? undefined : 0}
					enableProfileModal={false}
					showTooltips={false}
					onUserContextMenu={handleFriendContextMenu}
					users={sortedFriends.slice(0, friendAvatarMaxVisible)}
					guildId={profile.guildId ?? guildId}
					data-flx="user.profile.profile-card.profile-card-mutuals.friend-avatar-stack"
				/>
			)}
			{showPlaceIcons && (
				<AvatarStack
					className={placeIconStackClassName}
					size={mutualIconSize}
					maxVisible={placeIconMaxVisible}
					overlap={stackPlaceIcons ? undefined : 0}
					enableProfileModal={false}
					showTooltips={false}
				>
					{placeIconItems.map((place) =>
						place.kind === 'group' ? (
							<div key={place.group.id} className={styles.guildIconWrapper}>
								<GroupDMAvatar channel={place.group} size={mutualIconSize} />
							</div>
						) : (
							<div key={place.community.guild.id} className={styles.guildIconWrapper}>
								<GuildIcon
									id={place.community.guild.id}
									name={place.community.guild.name}
									icon={place.community.guild.icon}
									className={styles.guildIcon}
									sizePx={mutualIconSize}
								/>
							</div>
						),
					)}
				</AvatarStack>
			)}
			<div
				className={clsx(styles.mutualsText, showBothMutuals && styles.mutualsTextCompact)}
				data-flx="user.profile.profile-card.profile-card-mutuals.mutuals-text"
			>
				{hasMutualFriends && (
					<button
						type="button"
						className={styles.mutualLink}
						onClick={() => openProfileTab('mutual_friends')}
						data-flx="user.profile.profile-card.profile-card-mutuals.mutual-friends-link"
					>
						<span className={styles.mutualsLabel}>{friendsLabel}</span>
					</button>
				)}
				{hasMutualFriends && hasMutualPlaces && (
					<span className={styles.mutualsSeparator} aria-hidden="true">
						•
					</span>
				)}
				{hasMutualPlaces && (
					<button
						type="button"
						className={styles.mutualLink}
						onClick={() => openProfileTab('mutual_communities_groups')}
						data-flx="user.profile.profile-card.profile-card-mutuals.mutual-communities-link"
					>
						<span className={styles.mutualsPlacesLabel}>{placesLabel}</span>
					</button>
				)}
			</div>
		</div>
	);
});
