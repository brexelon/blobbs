// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import type {ThreadStateAction} from '@app/features/channel/commands/ThreadCommands';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import {ThreadSettingsModal} from '@app/features/channel/components/modals/ThreadSettingsModal';
import {useDeleteMyMessagesInChannel} from '@app/features/channel/hooks/useDeleteMyMessagesInChannel';
import Channels from '@app/features/channel/state/Channels';
import Threads from '@app/features/channel/state/Threads';
import {DELETE_MY_MESSAGES_DESCRIPTOR} from '@app/features/channel/utils/ChannelMessageDescriptors';
import {buildChannelLink} from '@app/features/messaging/utils/MessageLinkUtils';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {CopyIdIcon, CopyLinkIcon, DeleteIcon, EditIcon, LeaveIcon} from '@app/features/ui/action_menu/ContextMenuIcons';
import {
	ChannelNotificationSettingsMenuItem,
	MuteChannelMenuItem,
} from '@app/features/ui/action_menu/items/ChannelMenuItems';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as TextCopyCommands from '@app/features/ui/commands/TextCopyCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Permissions, ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {
	ArchiveIcon,
	ArrowSquareOutIcon,
	LockSimpleIcon,
	LockSimpleOpenIcon,
	SignInIcon,
	TrayArrowUpIcon,
} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

const logger = new Logger('ThreadContextMenu');

const GO_TO_THREAD_DESCRIPTOR = msg({
	message: 'Go to thread',
	comment: 'Thread context menu item that opens the thread in its full channel view.',
});
const JOIN_THREAD_DESCRIPTOR = msg({
	message: 'Join thread',
	comment: 'Thread context menu item that adds the current user to the thread.',
});
const LEAVE_THREAD_DESCRIPTOR = msg({
	message: 'Leave thread',
	comment: 'Thread context menu item that removes the current user from the thread.',
});
const COPY_THREAD_LINK_DESCRIPTOR = msg({
	message: 'Copy thread link',
	comment: 'Thread context menu item that copies a deep link to the thread.',
});
const CLOSE_THREAD_DESCRIPTOR = msg({
	message: 'Close thread',
	comment: 'Thread context menu item that closes an open thread (moderators only).',
});
const REOPEN_THREAD_DESCRIPTOR = msg({
	message: 'Reopen thread',
	comment: 'Thread context menu item that reopens a closed thread (moderators only).',
});
const ARCHIVE_THREAD_DESCRIPTOR = msg({
	message: 'Archive thread',
	comment: 'Thread context menu item that archives a thread (moderators only).',
});
const UNARCHIVE_THREAD_DESCRIPTOR = msg({
	message: 'Unarchive thread',
	comment: 'Thread context menu item that unarchives a thread (moderators only).',
});
const EDIT_THREAD_DESCRIPTOR = msg({
	message: 'Edit thread',
	comment: 'Thread context menu item that opens the thread settings modal (moderators only).',
});
const DELETE_THREAD_DESCRIPTOR = msg({
	message: 'Delete thread',
	comment: 'Thread context menu item that permanently deletes a thread (moderators only).',
});
const COPY_THREAD_ID_DESCRIPTOR = msg({
	message: 'Copy thread ID',
	comment: 'Thread context menu item that copies the thread ID.',
});
const DELETE_THREAD_TITLE_DESCRIPTOR = msg({
	message: 'Delete thread',
	comment: 'Title of the confirmation dialog shown before deleting a thread.',
});
const DELETE_THREAD_CONFIRM_DESCRIPTOR = msg({
	message: 'Delete "{threadName}"? Can\'t be undone.',
	comment: 'Body of the confirmation dialog shown before deleting a thread. {threadName} is inserted by code.',
});
const THREAD_JOINED_DESCRIPTOR = msg({
	message: 'Joined thread',
	comment: 'Toast shown after successfully joining a thread.',
});
const THREAD_LEFT_DESCRIPTOR = msg({
	message: 'Left thread',
	comment: 'Toast shown after successfully leaving a thread.',
});
const THREAD_DELETED_DESCRIPTOR = msg({
	message: 'Thread deleted',
	comment: 'Toast shown after successfully deleting a thread.',
});
const THREAD_ACTION_FAILED_DESCRIPTOR = msg({
	message: 'Something went wrong. Please try again.',
	comment: 'Toast shown when a thread management action fails.',
});

export interface ThreadContextMenuProps {
	threadId: string;
	threadName: string;
	threadState: number;
	isJoined: boolean;
	guildId: string | null;
	parentChannelId: string;
	onClose: () => void;
	onGoToThread: () => void;
}

export const ThreadContextMenu = observer(
	({
		threadId,
		threadName,
		threadState,
		isJoined,
		guildId,
		parentChannelId,
		onClose,
		onGoToThread,
	}: ThreadContextMenuProps) => {
		const {i18n} = useLingui();
		const threadChannel = Channels.getChannel(threadId);
		const deleteMyMessagesInChannel = useDeleteMyMessagesInChannel();
		const canManage = Permission.can(Permissions.MANAGE_CHANNELS, {
			channelId: parentChannelId,
			guildId: guildId ?? undefined,
		});
		const isArchived = threadState === ThreadStates.ARCHIVED;
		const isClosed = threadState === ThreadStates.CLOSED;
		const isOpen = threadState === ThreadStates.OPEN;

		const notifyFailure = (error: unknown, action: string) => {
			logger.error(`Failed to ${action} thread ${threadId}:`, error);
			ToastCommands.createToast({type: 'error', children: i18n._(THREAD_ACTION_FAILED_DESCRIPTOR)});
		};

		const handleGoToThread = () => {
			onClose();
			onGoToThread();
		};

		const handleJoin = async () => {
			onClose();
			try {
				const joined = await ThreadCommands.joinThread(threadId);
				Channels.handleChannelCreate({channel: joined});
				Threads.join(threadId);
				Permission.handleChannelUpdate(threadId);
				ToastCommands.createToast({type: 'success', children: i18n._(THREAD_JOINED_DESCRIPTOR)});
			} catch (error) {
				notifyFailure(error, 'join');
			}
		};

		const handleLeave = async () => {
			onClose();
			try {
				await ThreadCommands.leaveThread(threadId);
				Threads.leave(threadId);
				ToastCommands.createToast({type: 'success', children: i18n._(THREAD_LEFT_DESCRIPTOR)});
			} catch (error) {
				notifyFailure(error, 'leave');
			}
		};

		const handleCopyLink = () => {
			const link = buildChannelLink({guildId, channelId: threadId});
			TextCopyCommands.copy(i18n, link);
			onClose();
		};

		const handleStateChange = async (action: ThreadStateAction) => {
			onClose();
			try {
				const updated = await ThreadCommands.updateThread(threadId, {action});
				Channels.handleChannelCreate({channel: updated});
				Permission.handleChannelUpdate(threadId);
			} catch (error) {
				notifyFailure(error, action);
			}
		};

		const handleEdit = () => {
			onClose();
			ModalCommands.push(modal(() => <ThreadSettingsModal threadId={threadId} />));
		};

		const handleCopyId = () => {
			TextCopyCommands.copy(i18n, threadId);
			onClose();
		};

		const handleDeleteMyMessages = () => {
			onClose();
			deleteMyMessagesInChannel(threadId);
		};

		const handleDelete = () => {
			onClose();
			ModalCommands.push(
				modal(() => (
					<ConfirmModal
						title={i18n._(DELETE_THREAD_TITLE_DESCRIPTOR)}
						description={i18n._(DELETE_THREAD_CONFIRM_DESCRIPTOR, {threadName})}
						primaryText={i18n._(DELETE_THREAD_DESCRIPTOR)}
						primaryVariant="danger"
						onPrimary={async () => {
							try {
								await ThreadCommands.deleteThread(threadId);
								ToastCommands.createToast({type: 'success', children: i18n._(THREAD_DELETED_DESCRIPTOR)});
							} catch (error) {
								notifyFailure(error, 'delete');
							}
						}}
						data-flx="channel.thread-context-menu.delete-confirm-modal"
					/>
				)),
			);
		};

		return (
			<>
				<MenuGroup data-flx="channel.thread-context-menu.navigation-group">
					<MenuItem
						icon={<ArrowSquareOutIcon size={16} />}
						onClick={handleGoToThread}
						data-flx="channel.thread-context-menu.go-to-thread"
					>
						{i18n._(GO_TO_THREAD_DESCRIPTOR)}
					</MenuItem>
					{!isJoined && !isArchived && (
						<MenuItem icon={<SignInIcon size={16} />} onClick={handleJoin} data-flx="channel.thread-context-menu.join">
							{i18n._(JOIN_THREAD_DESCRIPTOR)}
						</MenuItem>
					)}
					{isJoined && !isArchived && (
						<MenuItem icon={<LeaveIcon size={16} />} onClick={handleLeave} data-flx="channel.thread-context-menu.leave">
							{i18n._(LEAVE_THREAD_DESCRIPTOR)}
						</MenuItem>
					)}
				</MenuGroup>
				<MenuGroup data-flx="channel.thread-context-menu.link-group">
					<MenuItem
						icon={<CopyLinkIcon size={16} />}
						onClick={handleCopyLink}
						data-flx="channel.thread-context-menu.copy-link"
					>
						{i18n._(COPY_THREAD_LINK_DESCRIPTOR)}
					</MenuItem>
				</MenuGroup>
				{threadChannel != null && (
					<MenuGroup data-flx="channel.thread-context-menu.notifications-group">
						<MuteChannelMenuItem
							channel={threadChannel}
							onClose={onClose}
							data-flx="channel.thread-context-menu.mute"
						/>
						<ChannelNotificationSettingsMenuItem
							channel={threadChannel}
							onClose={onClose}
							data-flx="channel.thread-context-menu.notification-settings"
						/>
					</MenuGroup>
				)}
				{canManage && (
					<MenuGroup data-flx="channel.thread-context-menu.moderation-group">
						<MenuItem icon={<EditIcon size={16} />} onClick={handleEdit} data-flx="channel.thread-context-menu.edit">
							{i18n._(EDIT_THREAD_DESCRIPTOR)}
						</MenuItem>
						{isOpen && (
							<MenuItem
								icon={<LockSimpleIcon size={16} />}
								onClick={() => handleStateChange('close')}
								data-flx="channel.thread-context-menu.close"
							>
								{i18n._(CLOSE_THREAD_DESCRIPTOR)}
							</MenuItem>
						)}
						{isClosed && (
							<MenuItem
								icon={<LockSimpleOpenIcon size={16} />}
								onClick={() => handleStateChange('open')}
								data-flx="channel.thread-context-menu.reopen"
							>
								{i18n._(REOPEN_THREAD_DESCRIPTOR)}
							</MenuItem>
						)}
						{!isArchived && (
							<MenuItem
								icon={<ArchiveIcon size={16} />}
								onClick={() => handleStateChange('archive')}
								data-flx="channel.thread-context-menu.archive"
							>
								{i18n._(ARCHIVE_THREAD_DESCRIPTOR)}
							</MenuItem>
						)}
						{isArchived && (
							<MenuItem
								icon={<TrayArrowUpIcon size={16} />}
								onClick={() => handleStateChange('unarchive')}
								data-flx="channel.thread-context-menu.unarchive"
							>
								{i18n._(UNARCHIVE_THREAD_DESCRIPTOR)}
							</MenuItem>
						)}
					</MenuGroup>
				)}
				<MenuGroup data-flx="channel.thread-context-menu.copy-id-group">
					<MenuItem
						icon={<CopyIdIcon size={16} />}
						onClick={handleCopyId}
						data-flx="channel.thread-context-menu.copy-id"
					>
						{i18n._(COPY_THREAD_ID_DESCRIPTOR)}
					</MenuItem>
				</MenuGroup>
				<MenuGroup data-flx="channel.thread-context-menu.danger-group">
					{canManage && (
						<MenuItem
							icon={<DeleteIcon size={16} />}
							onClick={handleDelete}
							danger
							data-flx="channel.thread-context-menu.delete"
						>
							{i18n._(DELETE_THREAD_DESCRIPTOR)}
						</MenuItem>
					)}
					<MenuItem
						icon={<DeleteIcon size={16} />}
						onClick={handleDeleteMyMessages}
						danger
						data-flx="channel.thread-context-menu.delete-my-messages"
					>
						{i18n._(DELETE_MY_MESSAGES_DESCRIPTOR)}
					</MenuItem>
				</MenuGroup>
			</>
		);
	},
);
