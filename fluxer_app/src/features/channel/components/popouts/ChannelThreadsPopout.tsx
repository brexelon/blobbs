// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import {ThreadContextMenu} from '@app/features/channel/components/menus/ThreadContextMenu';
import {ThreadCreateModal} from '@app/features/channel/components/modals/ThreadCreateModal';
import styles from '@app/features/channel/components/popouts/ChannelThreadsPopout.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import Threads from '@app/features/channel/state/Threads';
import GuildMembers from '@app/features/member/state/GuildMembers';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {getMessagePreviewText} from '@app/features/messaging/utils/MessagePreviewText';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {AvatarStack} from '@app/features/ui/avatars/AvatarStack';
import {Button} from '@app/features/ui/button/Button';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {User} from '@app/features/user/models/User';
import {getShortRelativeTime} from '@app/features/user/utils/DateFormatting';
import {Permissions, ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {DotsThreeIcon, MagnifyingGlassIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useMemo, useState} from 'react';

const logger = new Logger('ChannelThreadsPopout');

const THREADS_DESCRIPTOR = msg({
	message: 'Threads',
	comment: 'Title of the popout that lists the threads belonging to a channel.',
});
const SEARCH_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Search for Thread Name',
	comment: 'Placeholder for the thread search input in the channel threads popout.',
});
const CREATE_DESCRIPTOR = msg({
	message: 'Create',
	comment: 'Button in the channel threads popout header that starts a new thread.',
});
const CREATE_THREAD_DESCRIPTOR = msg({
	message: 'Create Thread',
	comment: 'Button in the channel threads popout empty state that starts a new thread.',
});
const LOADING_DESCRIPTOR = msg({
	message: 'Loading threads…',
	comment: 'Placeholder shown while the channel thread list is being fetched.',
});
const ERROR_DESCRIPTOR = msg({
	message: 'Could not load threads.',
	comment: 'Placeholder shown when the channel thread list fails to load.',
});
const NO_RESULTS_DESCRIPTOR = msg({
	message: 'No threads match your search.',
	comment: 'Placeholder shown when a thread search returns no results.',
});
const EMPTY_TITLE_DESCRIPTOR = msg({
	message: 'There are no threads.',
	comment: 'Title of the empty state shown when a channel has no threads.',
});
const EMPTY_BODY_DESCRIPTOR = msg({
	message: 'Stay focused on a conversation with a thread — a temporary text channel.',
	comment: 'Body of the empty state shown when a channel has no threads.',
});
const NO_RECENT_MESSAGES_DESCRIPTOR = msg({
	message: 'No recent messages',
	comment: 'Meta text shown for a thread row that has no messages yet.',
});
const JOINED_THREADS_DESCRIPTOR = msg({
	message: '{count} Joined Threads',
	comment: 'Section label above the list of threads the user has joined. {count} is inserted by code.',
});
const OTHER_THREADS_DESCRIPTOR = msg({
	message: '{count} Other Threads',
	comment: 'Section label above the list of threads the user has not joined. {count} is inserted by code.',
});
const ARCHIVED_DESCRIPTOR = msg({
	message: 'Archived',
	comment: 'Badge marking a thread whose lifecycle state is archived.',
});
const MORE_ACTIONS_DESCRIPTOR = msg({
	message: 'More options',
	comment: 'Accessible label for the button that opens the thread management menu.',
});

type LoadState = 'loading' | 'loaded' | 'error';

const MAX_JOINER_AVATARS = 5;

// Load a short tail of each thread's messages so the previews stay live (new,
// edited, and deleted messages all flow through the store) while the menu is open.
const PREVIEW_MESSAGE_LIMIT = 20;

const threadName = (thread: WireChannel): string => thread.thread_metadata?.name ?? thread.name ?? '';
const threadState = (thread: WireChannel): number => thread.thread_metadata?.state ?? ThreadStates.OPEN;
const isThreadJoined = (thread: WireChannel): boolean => Threads.isJoined(thread.id) || Boolean(thread.joined);

function lastActiveRelative(thread: WireChannel, lastMessage: Message | null): string | null {
	const referenceId = lastMessage?.id ?? thread.last_message_id ?? thread.id;
	if (!referenceId) {
		return null;
	}
	return getShortRelativeTime(extractTimestamp(referenceId)) || null;
}

export const ChannelThreadsPopout = observer(({channel, onClose}: {channel: Channel; onClose?: () => void}) => {
	const {i18n} = useLingui();
	const [threads, setThreads] = useState<ReadonlyArray<WireChannel>>([]);
	const [members, setMembers] = useState<Record<string, ReadonlyArray<User>>>({});
	const [loadState, setLoadState] = useState<LoadState>('loading');
	const [query, setQuery] = useState('');
	const canCreate = Permission.can(Permissions.CREATE_THREADS, channel);

	useEffect(() => {
		let cancelled = false;
		setLoadState('loading');
		setMembers({});
		ThreadCommands.listThreads(channel.id)
			.then(async (result) => {
				if (cancelled) return;
				setThreads(result);
				setLoadState('loaded');
				const entries = await Promise.all(
					result.map(async (thread) => {
						const [, threadMembers] = await Promise.all([
							// Seed the store so each row's preview reflects live message activity.
							MessageCommands.fetchMessages(thread.id, null, null, PREVIEW_MESSAGE_LIMIT).catch(() => []),
							ThreadCommands.listThreadMembers(thread.id)
								.then((rows) =>
									[...rows]
										// First to join first: the creator leads, newest joiner trails.
										.sort((a, b) => a.joined_at.localeCompare(b.joined_at))
										.map((row) => new User(row.user)),
								)
								.catch(() => [] as Array<User>),
						]);
						return [thread.id, threadMembers] as const;
					}),
				);
				if (cancelled) return;
				setMembers(Object.fromEntries(entries));
			})
			.catch((error) => {
				if (cancelled) return;
				logger.error(`Failed to load threads for channel ${channel.id}:`, error);
				setLoadState('error');
			});
		return () => {
			cancelled = true;
		};
	}, [channel.id]);

	const handleOpen = (thread: WireChannel) => {
		Channels.handleChannelCreate({channel: thread});
		if (thread.joined) {
			Threads.join(thread.id);
		}
		onClose?.();
		if (channel.guildId) {
			selectChannel(channel.guildId, thread.id);
		}
	};

	const handleCreate = () => {
		if (!channel.guildId) {
			return;
		}
		const guildId = channel.guildId;
		onClose?.();
		ModalCommands.push(modal(() => <ThreadCreateModal channelId={channel.id} guildId={guildId} />));
	};

	const openThreadMenu = (event: React.MouseEvent, thread: WireChannel) => {
		ContextMenuCommands.openFromEvent(event, ({onClose: onMenuClose}) => (
			<ThreadContextMenu
				threadId={thread.id}
				threadName={threadName(thread)}
				threadState={threadState(thread)}
				isJoined={isThreadJoined(thread)}
				guildId={channel.guildId ?? null}
				parentChannelId={channel.id}
				onClose={onMenuClose}
				onGoToThread={() => handleOpen(thread)}
			/>
		));
	};

	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return threads;
		}
		return threads.filter((thread) => threadName(thread).toLowerCase().includes(normalized));
	}, [threads, query]);

	const joinedThreads = filtered.filter((thread) => isThreadJoined(thread));
	const otherThreads = filtered.filter((thread) => !isThreadJoined(thread));

	const renderRow = (thread: WireChannel) => {
		const name = threadName(thread);
		const state = threadState(thread);
		// The store, seeded on open and kept current by MESSAGE_CREATE/UPDATE/DELETE
		// handling, drives the preview so it updates live while the menu is open.
		const storeCollection = Messages.getCachedMessages(thread.id);
		const lastMessage = storeCollection?.ready ? (storeCollection.last() ?? null) : null;
		const threadMembers = members[thread.id] ?? [];
		const authorColor = lastMessage
			? GuildMembers.getMember(channel.guildId ?? '', lastMessage.author.id)?.getColorString()
			: undefined;
		// Archived threads keep an explicit badge; closed ones are conveyed by dimming
		// the (bold) name instead of a label, since a closed thread reopens on the next
		// message and doesn't need calling out as prominently.
		const badge = state === ThreadStates.ARCHIVED ? i18n._(ARCHIVED_DESCRIPTOR) : null;
		const isClosed = state === ThreadStates.CLOSED;
		const relative = lastActiveRelative(thread, lastMessage);
		return (
			<div
				key={thread.id}
				className={styles.row}
				role="button"
				tabIndex={0}
				onClick={() => handleOpen(thread)}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						handleOpen(thread);
					}
				}}
				onContextMenu={(event) => openThreadMenu(event, thread)}
				data-flx="channel.channel-threads-popout.row"
			>
				<div className={styles.content} data-flx="channel.channel-threads-popout.content">
					<div className={styles.nameLine} data-flx="channel.channel-threads-popout.name-line">
						<span className={clsx(styles.name, isClosed && styles.nameClosed)}>{name}</span>
						{badge && <span className={styles.badge}>{badge}</span>}
					</div>
					<div className={styles.meta} data-flx="channel.channel-threads-popout.meta">
						{lastMessage ? (
							<span className={styles.metaMessage}>
								<span className={styles.metaAuthor} style={{color: authorColor}}>
									{lastMessage.author.displayName}:
								</span>{' '}
								{getMessagePreviewText(lastMessage, i18n)}
							</span>
						) : (
							<span className={styles.metaMessage}>{i18n._(NO_RECENT_MESSAGES_DESCRIPTOR)}</span>
						)}
						{relative && <span className={styles.metaTime}> • {relative}</span>}
					</div>
				</div>
				{threadMembers.length > 0 && (
					<AvatarStack
						users={threadMembers}
						size={28}
						maxVisible={MAX_JOINER_AVATARS}
						guildId={channel.guildId ?? null}
						enableProfileModal={false}
					/>
				)}
				<button
					type="button"
					className={styles.moreButton}
					aria-label={i18n._(MORE_ACTIONS_DESCRIPTOR)}
					onClick={(event) => {
						event.stopPropagation();
						openThreadMenu(event, thread);
					}}
					data-flx="channel.channel-threads-popout.more-button"
				>
					<DotsThreeIcon size={18} weight="bold" />
				</button>
			</div>
		);
	};

	const renderBody = () => {
		if (loadState === 'loading') {
			return (
				<div className={styles.stateMessage} data-flx="channel.channel-threads-popout.loading">
					{i18n._(LOADING_DESCRIPTOR)}
				</div>
			);
		}
		if (loadState === 'error') {
			return (
				<div className={styles.stateMessage} data-flx="channel.channel-threads-popout.error">
					{i18n._(ERROR_DESCRIPTOR)}
				</div>
			);
		}
		if (threads.length === 0) {
			return (
				<div className={styles.emptyState} data-flx="channel.channel-threads-popout.empty">
					<div className={styles.emptyMark} aria-hidden="true" data-flx="channel.channel-threads-popout.empty-mark">
						<ThreadIcon size={40} className={styles.emptyIcon} data-flx="channel.channel-threads-popout.empty-icon" />
					</div>
					<h2 className={styles.emptyTitle}>{i18n._(EMPTY_TITLE_DESCRIPTOR)}</h2>
					<p className={styles.emptyBody}>{i18n._(EMPTY_BODY_DESCRIPTOR)}</p>
					{canCreate && (
						<Button
							type="button"
							variant="primary"
							onClick={handleCreate}
							fitContent
							data-flx="channel.channel-threads-popout.empty-create"
						>
							{i18n._(CREATE_THREAD_DESCRIPTOR)}
						</Button>
					)}
				</div>
			);
		}
		if (filtered.length === 0) {
			return (
				<div className={styles.stateMessage} data-flx="channel.channel-threads-popout.no-results">
					{i18n._(NO_RESULTS_DESCRIPTOR)}
				</div>
			);
		}
		return (
			<>
				{joinedThreads.length > 0 && (
					<>
						<div className={styles.sectionLabel} data-flx="channel.channel-threads-popout.joined-label">
							{i18n._(JOINED_THREADS_DESCRIPTOR, {count: joinedThreads.length})}
						</div>
						{joinedThreads.map(renderRow)}
					</>
				)}
				{otherThreads.length > 0 && (
					<>
						<div className={styles.sectionLabel} data-flx="channel.channel-threads-popout.other-label">
							{i18n._(OTHER_THREADS_DESCRIPTOR, {count: otherThreads.length})}
						</div>
						{otherThreads.map(renderRow)}
					</>
				)}
			</>
		);
	};

	return (
		<div className={styles.container} data-flx="channel.channel-threads-popout.container">
			<div className={styles.header} data-flx="channel.channel-threads-popout.header">
				<div className={styles.headerTitleGroup} data-flx="channel.channel-threads-popout.header-title-group">
					<ThreadIcon size={22} className={styles.iconLarge} data-flx="channel.channel-threads-popout.icon-large" />
					<h1 className={styles.title} data-flx="channel.channel-threads-popout.title">
						{i18n._(THREADS_DESCRIPTOR)}
					</h1>
				</div>
				<div className={styles.search} data-flx="channel.channel-threads-popout.search">
					<MagnifyingGlassIcon size={16} className={styles.searchIcon} />
					<input
						type="text"
						className={styles.searchInput}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={i18n._(SEARCH_PLACEHOLDER_DESCRIPTOR)}
						aria-label={i18n._(SEARCH_PLACEHOLDER_DESCRIPTOR)}
						data-flx="channel.channel-threads-popout.search-input"
					/>
				</div>
				{canCreate && (
					<Button
						type="button"
						variant="primary"
						compact
						fitContent
						onClick={handleCreate}
						data-flx="channel.channel-threads-popout.create-button"
					>
						{i18n._(CREATE_DESCRIPTOR)}
					</Button>
				)}
			</div>
			<div className={styles.body} data-flx="channel.channel-threads-popout.body">
				{renderBody()}
			</div>
		</div>
	);
});
