// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import {ThreadContextMenu} from '@app/features/channel/components/menus/ThreadContextMenu';
import styles from '@app/features/channel/components/popouts/ChannelThreadsPopout.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import Threads from '@app/features/channel/state/Threads';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {Logger} from '@app/features/platform/utils/AppLogger';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {DotsThreeIcon} from '@phosphor-icons/react';
import {DateTime} from 'luxon';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useState} from 'react';

const logger = new Logger('ChannelThreadsPopout');

const THREADS_DESCRIPTOR = msg({
	message: 'Threads',
	comment: 'Title of the popout that lists the threads belonging to a channel.',
});
const LOADING_DESCRIPTOR = msg({
	message: 'Loading threads…',
	comment: 'Placeholder shown while the channel thread list is being fetched.',
});
const EMPTY_DESCRIPTOR = msg({
	message: 'There are no threads in this channel yet.',
	comment: 'Placeholder shown when a channel has no threads.',
});
const ERROR_DESCRIPTOR = msg({
	message: 'Could not load threads.',
	comment: 'Placeholder shown when the channel thread list fails to load.',
});
const CLOSED_DESCRIPTOR = msg({
	message: 'Closed',
	comment: 'Badge marking a thread whose lifecycle state is closed.',
});
const ARCHIVED_DESCRIPTOR = msg({
	message: 'Archived',
	comment: 'Badge marking a thread whose lifecycle state is archived.',
});
const LAST_ACTIVE_DESCRIPTOR = msg({
	message: 'Last active {relative}',
	comment: 'Meta line under a thread row showing when it was last active. {relative} is a relative time.',
});
const MORE_ACTIONS_DESCRIPTOR = msg({
	message: 'More options',
	comment: 'Accessible label for the button that opens the thread management menu.',
});

type LoadState = 'loading' | 'loaded' | 'error';

function formatLastActive(thread: WireChannel): string | null {
	const referenceId = thread.last_message_id ?? thread.id;
	if (!referenceId) {
		return null;
	}
	const timestamp = extractTimestamp(referenceId);
	const dateTime = DateTime.fromMillis(timestamp);
	return dateTime.isValid ? dateTime.toRelative() : null;
}

export const ChannelThreadsPopout = observer(({channel, onClose}: {channel: Channel; onClose?: () => void}) => {
	const {i18n} = useLingui();
	const [threads, setThreads] = useState<ReadonlyArray<WireChannel>>([]);
	const [loadState, setLoadState] = useState<LoadState>('loading');

	useEffect(() => {
		let cancelled = false;
		setLoadState('loading');
		ThreadCommands.listThreads(channel.id)
			.then((result) => {
				if (cancelled) return;
				setThreads(result);
				setLoadState('loaded');
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

	const openThreadMenu = (event: React.MouseEvent, thread: WireChannel) => {
		const state = thread.thread_metadata?.state ?? ThreadStates.OPEN;
		const name = thread.thread_metadata?.name ?? thread.name ?? '';
		const isJoined = Threads.isJoined(thread.id) || Boolean(thread.joined);
		ContextMenuCommands.openFromEvent(event, ({onClose: onMenuClose}) => (
			<ThreadContextMenu
				threadId={thread.id}
				threadName={name}
				threadState={state}
				isJoined={isJoined}
				guildId={channel.guildId ?? null}
				parentChannelId={channel.id}
				onClose={onMenuClose}
				onGoToThread={() => handleOpen(thread)}
			/>
		));
	};

	return (
		<div className={styles.container} data-flx="channel.channel-threads-popout.container">
			<div className={styles.header} data-flx="channel.channel-threads-popout.header">
				<ThreadIcon size={24} className={styles.iconLarge} data-flx="channel.channel-threads-popout.icon-large" />
				<h1 className={styles.title} data-flx="channel.channel-threads-popout.title">
					{i18n._(THREADS_DESCRIPTOR)}
				</h1>
			</div>
			<div className={styles.body} data-flx="channel.channel-threads-popout.body">
				{loadState === 'loading' ? (
					<div className={styles.stateMessage} data-flx="channel.channel-threads-popout.loading">
						{i18n._(LOADING_DESCRIPTOR)}
					</div>
				) : loadState === 'error' ? (
					<div className={styles.stateMessage} data-flx="channel.channel-threads-popout.error">
						{i18n._(ERROR_DESCRIPTOR)}
					</div>
				) : threads.length === 0 ? (
					<div className={styles.stateMessage} data-flx="channel.channel-threads-popout.empty">
						{i18n._(EMPTY_DESCRIPTOR)}
					</div>
				) : (
					threads.map((thread) => {
						const state = thread.thread_metadata?.state ?? ThreadStates.OPEN;
						const name = thread.thread_metadata?.name ?? thread.name ?? '';
						const isJoined = Threads.isJoined(thread.id) || Boolean(thread.joined);
						const badge =
							state === ThreadStates.ARCHIVED
								? i18n._(ARCHIVED_DESCRIPTOR)
								: state === ThreadStates.CLOSED
									? i18n._(CLOSED_DESCRIPTOR)
									: null;
						const lastActive = formatLastActive(thread);
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
								<ThreadIcon size={18} className={styles.icon} data-flx="channel.channel-threads-popout.icon" />
								<div className={styles.content} data-flx="channel.channel-threads-popout.content">
									<div className={styles.nameLine} data-flx="channel.channel-threads-popout.name-line">
										<span className={styles.name}>{name}</span>
										{badge && <span className={styles.badge}>{badge}</span>}
										{isJoined && <span className={styles.joinedDot} aria-hidden="true" />}
									</div>
									{lastActive && (
										<div className={styles.meta} data-flx="channel.channel-threads-popout.meta">
											{i18n._(LAST_ACTIVE_DESCRIPTOR, {relative: lastActive})}
										</div>
									)}
								</div>
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
					})
				)}
			</div>
		</div>
	);
});
