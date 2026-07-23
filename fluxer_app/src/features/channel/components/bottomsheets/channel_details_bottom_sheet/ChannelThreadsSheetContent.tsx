// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import styles from '@app/features/channel/components/bottomsheets/channel_details_bottom_sheet/ChannelThreadsSheetContent.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import ThreadSidebar from '@app/features/channel/state/ThreadSidebar';
import Threads from '@app/features/channel/state/Threads';
import {openThreadFullView} from '@app/features/channel/utils/ThreadNavigationUtils';
import GuildMembers from '@app/features/member/state/GuildMembers';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {getMessagePreviewText} from '@app/features/messaging/utils/MessagePreviewText';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {getShortRelativeTime} from '@app/features/user/utils/DateFormatting';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretRightIcon, PlusIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const logger = new Logger('ChannelThreadsSheetContent');

const CREATE_THREAD_DESCRIPTOR = msg({
	message: 'Create Thread',
	comment: 'Button in the mobile threads tab that starts a new thread.',
});
const JOINED_THREADS_DESCRIPTOR = msg({
	message: 'Joined Threads - {count}',
	comment: 'Section header in the mobile threads tab for threads the user has joined. {count} is inserted by code.',
});
const ACTIVE_THREADS_DESCRIPTOR = msg({
	message: 'Active Threads - {count}',
	comment: 'Section header in the mobile threads tab for threads the user has not joined. {count} is inserted by code.',
});
const NO_RECENT_MESSAGES_DESCRIPTOR = msg({
	message: 'No recent messages',
	comment: 'Meta text for a thread row with no messages yet in the mobile threads tab.',
});
const LOADING_DESCRIPTOR = msg({
	message: 'Loading threads…',
	comment: 'Placeholder shown while the mobile threads tab is loading.',
});
const ERROR_DESCRIPTOR = msg({
	message: 'Could not load threads.',
	comment: 'Placeholder shown when the mobile threads tab fails to load.',
});
const EMPTY_DESCRIPTOR = msg({
	message: 'There are no threads yet.',
	comment: 'Placeholder shown when a channel has no threads in the mobile threads tab.',
});

type LoadState = 'loading' | 'loaded' | 'error';

// Load a short tail of each thread's messages so the previews reflect live
// activity while the tab is open, matching the desktop threads popout.
const PREVIEW_MESSAGE_LIMIT = 20;

const threadName = (thread: WireChannel): string => thread.thread_metadata?.name ?? thread.name ?? '';
const isThreadJoined = (thread: WireChannel): boolean => Threads.isJoined(thread.id) || Boolean(thread.joined);

function lastActiveRelative(thread: WireChannel, lastMessage: Message | null): string | null {
	const referenceId = lastMessage?.id ?? thread.last_message_id ?? thread.id;
	if (!referenceId) {
		return null;
	}
	return getShortRelativeTime(extractTimestamp(referenceId)) || null;
}

export const ChannelThreadsSheetContent = observer(({channel, onClose}: {channel: Channel; onClose: () => void}) => {
	const {i18n} = useLingui();
	const [threads, setThreads] = useState<ReadonlyArray<WireChannel>>([]);
	const [loadState, setLoadState] = useState<LoadState>('loading');
	const canCreate = Permission.can(Permissions.CREATE_THREADS, channel);
	// Observe the message store version so previews refresh as messages arrive.
	void Messages.version;

	useEffect(() => {
		let cancelled = false;
		setLoadState('loading');
		ThreadCommands.listThreads(channel.id)
			.then((result) => {
				if (cancelled) {
					return;
				}
				setThreads(result);
				setLoadState('loaded');
				for (const thread of result) {
					void MessageCommands.fetchMessages(thread.id, null, null, PREVIEW_MESSAGE_LIMIT).catch(() => []);
				}
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				logger.error(`Failed to load threads for channel ${channel.id}:`, error);
				setLoadState('error');
			});
		return () => {
			cancelled = true;
		};
	}, [channel.id]);

	const handleCreate = () => {
		const guildId = channel.guildId;
		if (!guildId) {
			return;
		}
		onClose();
		ThreadSidebar.openCreate({parentChannelId: channel.id, guildId});
	};

	const handleOpen = (thread: WireChannel) => {
		if (!channel.guildId) {
			return;
		}
		void openThreadFullView({guildId: channel.guildId, threadId: thread.id, parentChannelId: channel.id});
		onClose();
	};

	const sorted = [...threads].sort((a, b) =>
		Number(BigInt(b.last_message_id ?? b.id) - BigInt(a.last_message_id ?? a.id)),
	);
	const joined = sorted.filter((thread) => isThreadJoined(thread));
	const active = sorted.filter((thread) => !isThreadJoined(thread));

	const renderRow = (thread: WireChannel) => {
		const storeCollection = Messages.getCachedMessages(thread.id);
		const lastMessage = storeCollection?.ready ? (storeCollection.last() ?? null) : null;
		const relative = lastActiveRelative(thread, lastMessage);
		const authorColor = lastMessage
			? GuildMembers.getMember(channel.guildId ?? '', lastMessage.author.id)?.getColorString()
			: undefined;
		return (
			<button
				key={thread.id}
				type="button"
				className={styles.row}
				onClick={() => handleOpen(thread)}
				data-flx="channel.channel-threads-sheet-content.row"
			>
				<div className={styles.rowBody} data-flx="channel.channel-threads-sheet-content.row-body">
					<span className={styles.rowName}>{threadName(thread)}</span>
					<span className={styles.rowMeta}>
						{lastMessage ? (
							<>
								<span className={styles.rowMetaAuthor} style={{color: authorColor}}>
									{lastMessage.author.displayName}
								</span>{' '}
								{getMessagePreviewText(lastMessage, i18n)}
							</>
						) : (
							i18n._(NO_RECENT_MESSAGES_DESCRIPTOR)
						)}
						{relative && <span className={styles.rowMetaTime}> • {relative}</span>}
					</span>
				</div>
				<CaretRightIcon size={18} className={styles.rowCaret} data-flx="channel.channel-threads-sheet-content.caret" />
			</button>
		);
	};

	const renderBody = () => {
		if (loadState === 'loading') {
			return <div className={styles.stateMessage}>{i18n._(LOADING_DESCRIPTOR)}</div>;
		}
		if (loadState === 'error') {
			return <div className={styles.stateMessage}>{i18n._(ERROR_DESCRIPTOR)}</div>;
		}
		if (threads.length === 0) {
			return <div className={styles.stateMessage}>{i18n._(EMPTY_DESCRIPTOR)}</div>;
		}
		return (
			<>
				{joined.length > 0 && (
					<>
						<div className={styles.sectionLabel}>{i18n._(JOINED_THREADS_DESCRIPTOR, {count: joined.length})}</div>
						{joined.map(renderRow)}
					</>
				)}
				{active.length > 0 && (
					<>
						<div className={styles.sectionLabel}>{i18n._(ACTIVE_THREADS_DESCRIPTOR, {count: active.length})}</div>
						{active.map(renderRow)}
					</>
				)}
			</>
		);
	};

	return (
		<div className={styles.container} data-flx="channel.channel-threads-sheet-content.container">
			{canCreate && (
				<button
					type="button"
					className={styles.createButton}
					onClick={handleCreate}
					data-flx="channel.channel-threads-sheet-content.create"
				>
					<span className={styles.createIcon} aria-hidden="true">
						<PlusIcon size={18} weight="bold" />
					</span>
					<span className={styles.createLabel}>{i18n._(CREATE_THREAD_DESCRIPTOR)}</span>
					<CaretRightIcon size={18} className={styles.rowCaret} />
				</button>
			)}
			{renderBody()}
		</div>
	);
});
