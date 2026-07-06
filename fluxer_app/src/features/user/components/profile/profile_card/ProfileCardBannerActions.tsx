// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import * as PrivateChannelCommands from '@app/features/channel/commands/PrivateChannelCommands';
import {
	COPY_USER_ID_DESCRIPTOR,
	COPY_USERNAME_DESCRIPTOR,
	START_VIDEO_CALL_DESCRIPTOR,
	START_VOICE_CALL_DESCRIPTOR,
} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {BLOCK_DESCRIPTOR, REPORT_USER_DESCRIPTOR} from '@app/features/moderation/utils/ModerationMessageDescriptors';
import {openReportUserModal} from '@app/features/moderation/utils/ReportActionUtils';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Relationships from '@app/features/relationship/state/Relationships';
import * as RelationshipActionUtils from '@app/features/relationship/utils/RelationshipActionUtils';
import {
	ACCEPT_FRIEND_REQUEST_DESCRIPTOR,
	CANCEL_FRIEND_REQUEST_DESCRIPTOR,
	REMOVE_FRIEND_DESCRIPTOR,
	SEND_FRIEND_REQUEST_DESCRIPTOR,
	UNBLOCK_USER_ACTION_DESCRIPTOR,
} from '@app/features/relationship/utils/RelationshipMessageDescriptors';
import type {ContextMenuActionEvent} from '@app/features/ui/action_menu/ContextMenu';
import {
	getUserMenuAvatarUrl,
	getUserMenuBannerUrl,
	UserImageMenuItems,
} from '@app/features/ui/action_menu/items/UserImageMenuItems';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import * as TextCopyCommands from '@app/features/ui/commands/TextCopyCommands';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import ContextMenu from '@app/features/ui/state/ContextMenu';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import styles from '@app/features/user/components/profile/profile_card/ProfileCardBannerActions.module.css';
import type {Profile} from '@app/features/user/models/Profile';
import type {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import type * as ProfileDisplayUtils from '@app/features/user/utils/ProfileDisplayUtils';
import * as CallUtils from '@app/features/voice/utils/CallUtils';
import {hasActiveDirectCallWithUser} from '@app/features/voice/utils/PrivateCallMenuUtils';
import {PublicUserFlags, RelationshipTypes} from '@fluxer/constants/src/UserConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {
	CheckCircleIcon,
	ClockCounterClockwiseIcon,
	CopyIcon,
	DotsThreeIcon,
	FlagIcon,
	IdentificationCardIcon,
	PhoneIcon,
	ProhibitIcon,
	UserCheckIcon,
	UserMinusIcon,
	UserPlusIcon,
	VideoCameraIcon,
} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useRef} from 'react';

const MORE_ACTIONS_DESCRIPTOR = msg({
	message: 'More actions',
	comment: 'Accessible label for the profile card more options button. Keep it concise.',
});
const VIEW_FULL_PROFILE_DESCRIPTOR = msg({
	message: 'View full profile',
	comment: 'Button or menu action label in the profile card more options menu. Keep it concise.',
});
const CLAIM_YOUR_ACCOUNT_TO_SEND_FRIEND_REQUESTS_DESCRIPTOR = msg({
	message: 'Claim your account to send friend requests.',
	comment: 'Tooltip shown when an unclaimed account tries to send a friend request from the profile card.',
});
const logger = new Logger('ProfileCardBannerActions');

interface ProfileCardBannerActionsProps {
	user: User;
	profile: Profile | null;
	profileContext: ProfileDisplayUtils.ProfileDisplayContext;
	guildId?: string;
	isCurrentUser?: boolean;
	onViewFullProfile?: () => void;
}

export const ProfileCardBannerActions: React.FC<ProfileCardBannerActionsProps> = observer(
	({user, profile, profileContext, guildId, isCurrentUser = false, onViewFullProfile}) => {
		const {i18n} = useLingui();
		const relationshipType = Relationships.getRelationship(user.id)?.type;
		const isUserBot = user.bot;
		const isFriendlyBot = isUserBot && (user.flags & PublicUserFlags.FRIENDLY_BOT) === PublicUserFlags.FRIENDLY_BOT;
		const currentUserUnclaimed = !(Users.currentUser?.isClaimed() ?? true);
		const hasActiveDirectCall = hasActiveDirectCallWithUser(user.id);
		const friendButtonRef = useRef<HTMLButtonElement>(null);
		const moreOptionsButtonRef = useRef<HTMLButtonElement>(null);
		const hasImageMenuItems = Boolean(
			getUserMenuAvatarUrl({user, profile, profileContext}) || getUserMenuBannerUrl({user, profile, profileContext}),
		);
		const handleSendFriendRequest = useCallback(() => {
			RelationshipActionUtils.sendFriendRequest(i18n, user.id);
		}, [i18n, user.id]);
		const handleAcceptFriendRequest = useCallback(
			(event?: {shiftKey?: boolean}) => {
				RelationshipActionUtils.showAcceptFriendRequestConfirmation(i18n, user, {
					bypassConfirm: RelationshipActionUtils.shouldBypassRelationshipConfirmation(event),
					showShiftBypassConfirmationTip: true,
				});
			},
			[i18n, user],
		);
		const handleRemoveFriend = useCallback(
			(event?: {shiftKey?: boolean}) => {
				RelationshipActionUtils.showRemoveFriendConfirmation(i18n, user, {
					bypassConfirm: RelationshipActionUtils.shouldBypassRelationshipConfirmation(event),
					showShiftBypassConfirmationTip: true,
				});
			},
			[i18n, user],
		);
		const handleBlockUser = useCallback(
			(event?: {shiftKey?: boolean}) => {
				RelationshipActionUtils.showBlockUserConfirmation(i18n, user, {
					bypassConfirm: RelationshipActionUtils.shouldBypassRelationshipConfirmation(event),
					showShiftBypassConfirmationTip: true,
				});
			},
			[i18n, user],
		);
		const handleUnblockUser = useCallback(
			(event?: {shiftKey?: boolean}) => {
				RelationshipActionUtils.showUnblockUserConfirmation(i18n, user, {
					bypassConfirm: RelationshipActionUtils.shouldBypassRelationshipConfirmation(event),
					showShiftBypassConfirmationTip: true,
				});
			},
			[i18n, user],
		);
		const handleCancelFriendRequest = useCallback(() => {
			RelationshipActionUtils.cancelFriendRequest(i18n, user.id);
		}, [i18n, user.id]);
		const handleStartVoiceCall = useCallback(
			async (event?: ContextMenuActionEvent) => {
				try {
					const channelId = await PrivateChannelCommands.ensureDMChannel(user.id);
					await CallUtils.requestStartCall(i18n, channelId, CallUtils.getCallStartRequestOptions(event, {kind: 'voice'}));
				} catch (error) {
					logger.error('Failed to start voice call', error);
				}
			},
			[i18n, user.id],
		);
		const handleStartVideoCall = useCallback(
			async (event?: ContextMenuActionEvent) => {
				try {
					const channelId = await PrivateChannelCommands.ensureDMChannel(user.id);
					await CallUtils.requestStartCall(i18n, channelId, CallUtils.getCallStartRequestOptions(event, {kind: 'video'}));
				} catch (error) {
					logger.error('Failed to start video call', error);
				}
			},
			[i18n, user.id],
		);
		const handleReportUser = useCallback(() => {
			openReportUserModal({i18n, user, guildId});
		}, [i18n, user, guildId]);
		const handleCopyFluxerTag = useCallback(() => {
			TextCopyCommands.copy(i18n, user.username, true);
		}, [i18n, user.username]);
		const handleCopyUserId = useCallback(() => {
			TextCopyCommands.copy(i18n, user.id, true);
		}, [i18n, user.id]);
		const handleMoreOptionsPointerDown = useCallback((event: React.PointerEvent) => {
			const contextMenu = ContextMenu.contextMenu;
			const isOpen = !!contextMenu && contextMenu.target.target === moreOptionsButtonRef.current;
			if (isOpen) {
				event.stopPropagation();
				event.preventDefault();
				ContextMenuCommands.close();
			}
		}, []);
		const renderBlockMenuItem = useCallback(
			(onClose: () => void) => {
				if (user.system) {
					return null;
				}
				switch (relationshipType) {
					case RelationshipTypes.BLOCKED:
						return (
							<MenuItem
								icon={<ProhibitIcon data-flx="user.profile.profile-card.profile-card-banner-actions.block-menu-item.prohibit-icon" />}
								onClick={(event) => {
									handleUnblockUser(event);
									onClose();
								}}
								data-flx="user.profile.profile-card.profile-card-banner-actions.block-menu-item.unblock-user"
							>
								{i18n._(UNBLOCK_USER_ACTION_DESCRIPTOR)}
							</MenuItem>
						);
					default:
						return (
							<MenuItem
								icon={<ProhibitIcon data-flx="user.profile.profile-card.profile-card-banner-actions.block-menu-item.prohibit-icon--2" />}
								onClick={(event) => {
									handleBlockUser(event);
									onClose();
								}}
								danger
								data-flx="user.profile.profile-card.profile-card-banner-actions.block-menu-item.block-user"
							>
								{i18n._(BLOCK_DESCRIPTOR)}
							</MenuItem>
						);
				}
			},
			[handleBlockUser, handleUnblockUser, i18n, relationshipType, user.system],
		);
		const openMoreOptionsMenu = useCallback(
			(event: React.MouseEvent<HTMLButtonElement>) => {
				const contextMenu = ContextMenu.contextMenu;
				const isOpen = !!contextMenu && contextMenu.target.target === event.currentTarget;
				if (isOpen) {
					return;
				}
				ContextMenuCommands.openFromElementBottomRight(event, (props) => (
					<>
						{onViewFullProfile && (
							<MenuGroup data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.menu-group">
								<MenuItem
									icon={
										<IdentificationCardIcon data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.identification-card-icon" />
									}
									onClick={() => {
										onViewFullProfile();
										props.onClose();
									}}
									data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.view-full-profile"
								>
									{i18n._(VIEW_FULL_PROFILE_DESCRIPTOR)}
								</MenuItem>
							</MenuGroup>
						)}
						{!isCurrentUser &&
							!isUserBot &&
							relationshipType === RelationshipTypes.FRIEND &&
							!hasActiveDirectCall &&
							!RuntimeConfig.directMessagesDisabled && (
								<MenuGroup data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.menu-group--2">
									<MenuItem
										icon={<PhoneIcon data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.phone-icon" />}
										onClick={(pressEvent) => {
											handleStartVoiceCall(pressEvent);
											props.onClose();
										}}
										data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.start-voice-call"
									>
										{i18n._(START_VOICE_CALL_DESCRIPTOR)}
									</MenuItem>
									<MenuItem
										icon={
											<VideoCameraIcon data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.video-camera-icon" />
										}
										onClick={(pressEvent) => {
											handleStartVideoCall(pressEvent);
											props.onClose();
										}}
										data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.start-video-call"
									>
										{i18n._(START_VIDEO_CALL_DESCRIPTOR)}
									</MenuItem>
								</MenuGroup>
							)}
						<MenuGroup data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.menu-group--3">
							<MenuItem
								icon={<CopyIcon data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.copy-icon" />}
								onClick={() => {
									handleCopyFluxerTag();
									props.onClose();
								}}
								data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.copy-fluxer-tag"
							>
								{i18n._(COPY_USERNAME_DESCRIPTOR)}
							</MenuItem>
							<MenuItem
								icon={
									<IdentificationCardIcon data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.identification-card-icon--2" />
								}
								onClick={() => {
									handleCopyUserId();
									props.onClose();
								}}
								data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.copy-user-id"
							>
								{i18n._(COPY_USER_ID_DESCRIPTOR)}
							</MenuItem>
						</MenuGroup>
						{!isCurrentUser && relationshipType === RelationshipTypes.FRIEND && !RuntimeConfig.directMessagesDisabled && (
							<MenuGroup data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.menu-group--4">
								<MenuItem
									icon={
										<UserMinusIcon
											className={styles.icon}
											weight="fill"
											data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.user-minus-icon"
										/>
									}
									onClick={(pressEvent) => {
										handleRemoveFriend(pressEvent);
										props.onClose();
									}}
									danger
									data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.remove-friend"
								>
									{i18n._(REMOVE_FRIEND_DESCRIPTOR)}
								</MenuItem>
							</MenuGroup>
						)}
						{!isCurrentUser && (
							<MenuGroup data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.menu-group--5">
								<MenuItem
									icon={<FlagIcon data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.flag-icon" />}
									onClick={() => {
										handleReportUser();
										props.onClose();
									}}
									danger
									data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.report-user"
								>
									{i18n._(REPORT_USER_DESCRIPTOR)}
								</MenuItem>
								{renderBlockMenuItem(props.onClose)}
							</MenuGroup>
						)}
						{hasImageMenuItems && (
							<UserImageMenuItems
								user={user}
								profile={profile}
								profileContext={profileContext}
								onClose={props.onClose}
								data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-menu.user-image-menu-items"
							/>
						)}
					</>
				));
			},
			[
				handleCopyFluxerTag,
				handleCopyUserId,
				handleRemoveFriend,
				handleReportUser,
				handleStartVideoCall,
				handleStartVoiceCall,
				hasActiveDirectCall,
				hasImageMenuItems,
				i18n,
				isCurrentUser,
				isUserBot,
				onViewFullProfile,
				profile,
				profileContext,
				relationshipType,
				renderBlockMenuItem,
				user,
			],
		);
		const renderRelationshipButton = () => {
			if (isCurrentUser || (isUserBot && !isFriendlyBot)) {
				return null;
			}
			if (RuntimeConfig.directMessagesDisabled && relationshipType !== RelationshipTypes.BLOCKED) {
				return null;
			}
			if (relationshipType === RelationshipTypes.FRIEND) {
				return (
					<Tooltip text={i18n._(REMOVE_FRIEND_DESCRIPTOR)} maxWidth="xl">
						<FocusRing offset={-2} focusTarget={friendButtonRef} ringTarget={friendButtonRef}>
							<button
								ref={friendButtonRef}
								type="button"
								onClick={(event) => handleRemoveFriend(event)}
								className={styles.actionButton}
								aria-label={i18n._(REMOVE_FRIEND_DESCRIPTOR)}
								data-flx="user.profile.profile-card.profile-card-banner-actions.relationship-button.remove-friend"
							>
								<UserCheckIcon className={styles.icon} weight="fill" />
							</button>
						</FocusRing>
					</Tooltip>
				);
			}
			if (relationshipType === RelationshipTypes.BLOCKED) {
				return (
					<Tooltip text={i18n._(UNBLOCK_USER_ACTION_DESCRIPTOR)} maxWidth="xl">
						<FocusRing offset={-2} focusTarget={friendButtonRef} ringTarget={friendButtonRef}>
							<button
								ref={friendButtonRef}
								type="button"
								onClick={(event) => handleUnblockUser(event)}
								className={styles.actionButton}
								aria-label={i18n._(UNBLOCK_USER_ACTION_DESCRIPTOR)}
								data-flx="user.profile.profile-card.profile-card-banner-actions.relationship-button.unblock-user"
							>
								<ProhibitIcon className={styles.icon} weight="fill" />
							</button>
						</FocusRing>
					</Tooltip>
				);
			}
			if (relationshipType === RelationshipTypes.INCOMING_REQUEST) {
				return (
					<Tooltip text={i18n._(ACCEPT_FRIEND_REQUEST_DESCRIPTOR)} maxWidth="xl">
						<FocusRing offset={-2} focusTarget={friendButtonRef} ringTarget={friendButtonRef}>
							<button
								ref={friendButtonRef}
								type="button"
								onClick={(event) => handleAcceptFriendRequest(event)}
								className={styles.actionButton}
								aria-label={i18n._(ACCEPT_FRIEND_REQUEST_DESCRIPTOR)}
								data-flx="user.profile.profile-card.profile-card-banner-actions.relationship-button.accept-friend-request"
							>
								<CheckCircleIcon className={styles.icon} weight="fill" />
							</button>
						</FocusRing>
					</Tooltip>
				);
			}
			if (relationshipType === RelationshipTypes.OUTGOING_REQUEST) {
				return (
					<Tooltip text={i18n._(CANCEL_FRIEND_REQUEST_DESCRIPTOR)} maxWidth="xl">
						<FocusRing offset={-2} focusTarget={friendButtonRef} ringTarget={friendButtonRef}>
							<button
								ref={friendButtonRef}
								type="button"
								onClick={handleCancelFriendRequest}
								className={styles.actionButton}
								aria-label={i18n._(CANCEL_FRIEND_REQUEST_DESCRIPTOR)}
								data-flx="user.profile.profile-card.profile-card-banner-actions.relationship-button.cancel-friend-request"
							>
								<ClockCounterClockwiseIcon className={styles.icon} weight="fill" />
							</button>
						</FocusRing>
					</Tooltip>
				);
			}
			if (relationshipType === undefined && (!isUserBot || isFriendlyBot)) {
				const tooltipText = currentUserUnclaimed
					? i18n._(CLAIM_YOUR_ACCOUNT_TO_SEND_FRIEND_REQUESTS_DESCRIPTOR)
					: i18n._(SEND_FRIEND_REQUEST_DESCRIPTOR);
				return (
					<Tooltip text={tooltipText} maxWidth="xl">
						<FocusRing offset={-2} focusTarget={friendButtonRef} ringTarget={friendButtonRef}>
							<button
								ref={friendButtonRef}
								type="button"
								onClick={handleSendFriendRequest}
								className={styles.actionButton}
								aria-label={i18n._(SEND_FRIEND_REQUEST_DESCRIPTOR)}
								disabled={currentUserUnclaimed}
								data-flx="user.profile.profile-card.profile-card-banner-actions.relationship-button.send-friend-request"
							>
								<UserPlusIcon className={styles.icon} weight="fill" />
							</button>
						</FocusRing>
					</Tooltip>
				);
			}
			return null;
		};
		const relationshipButton = renderRelationshipButton();
		return (
			<div className={styles.actionsContainer} data-flx="user.profile.profile-card.profile-card-banner-actions.actions-container">
				{relationshipButton}
				<Tooltip text={i18n._(MORE_ACTIONS_DESCRIPTOR)} maxWidth="xl">
					<FocusRing offset={-2} focusTarget={moreOptionsButtonRef} ringTarget={moreOptionsButtonRef}>
						<button
							ref={moreOptionsButtonRef}
							type="button"
							onPointerDownCapture={handleMoreOptionsPointerDown}
							onClick={openMoreOptionsMenu}
							className={styles.actionButton}
							aria-label={i18n._(MORE_ACTIONS_DESCRIPTOR)}
							data-flx="user.profile.profile-card.profile-card-banner-actions.more-options-button"
						>
							<DotsThreeIcon className={styles.icon} weight="bold" />
						</button>
					</FocusRing>
				</Tooltip>
			</div>
		);
	},
);
