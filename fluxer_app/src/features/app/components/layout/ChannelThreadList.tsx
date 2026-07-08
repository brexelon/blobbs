// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/app/components/layout/ChannelThreadList.module.css';
import {ThreadContextMenu} from '@app/features/channel/components/menus/ThreadContextMenu';
import Threads from '@app/features/channel/state/Threads';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import UserGuildSettings from '@app/features/user/state/UserGuildSettings';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback} from 'react';

interface ChannelThreadListProps {
	guildId: string;
	channelId: string;
	selectedChannelId: string | null;
}

export const ChannelThreadList = observer(({guildId, channelId, selectedChannelId}: ChannelThreadListProps) => {
	const threads = Threads.getSidebarThreads(channelId);
	if (threads.length === 0) {
		return null;
	}
	// Keep a muted channel's threads out of the sidebar unless the user is actively
	// in that channel (clicked into it) — revealing again once it's unmuted.
	const isParentMuted = UserGuildSettings.isChannelMuted(guildId, channelId);
	if (isParentMuted && selectedChannelId !== channelId) {
		return null;
	}
	return (
		<div className={styles.list} data-flx="app.channel-thread-list">
			{threads.map((thread) => (
				<ThreadRow
					key={thread.id}
					guildId={guildId}
					parentChannelId={channelId}
					threadId={thread.id}
					name={thread.threadMetadata?.name ?? thread.name ?? ''}
					state={thread.threadMetadata?.state ?? ThreadStates.OPEN}
					isSelected={selectedChannelId === thread.id}
				/>
			))}
		</div>
	);
});

const ThreadRow = observer(
	({
		guildId,
		parentChannelId,
		threadId,
		name,
		state,
		isSelected,
	}: {
		guildId: string;
		parentChannelId: string;
		threadId: string;
		name: string;
		state: number;
		isSelected: boolean;
	}) => {
		const handleClick = useCallback(() => {
			selectChannel(guildId, threadId);
		}, [guildId, threadId]);
		const handleContextMenu = useCallback(
			(event: React.MouseEvent) => {
				ContextMenuCommands.openFromEvent(event, ({onClose}) => (
					<ThreadContextMenu
						threadId={threadId}
						threadName={name}
						threadState={state}
						isJoined={Threads.isJoined(threadId)}
						guildId={guildId}
						parentChannelId={parentChannelId}
						onClose={onClose}
						onGoToThread={() => selectChannel(guildId, threadId)}
					/>
				));
			},
			[guildId, parentChannelId, threadId, name, state],
		);
		// Dim a muted thread's name (unless it's the active view), matching how muted
		// text channels read in the sidebar.
		const isMuted = UserGuildSettings.isChannelMuted(guildId, threadId);
		return (
			<button
				type="button"
				className={clsx(styles.row, isSelected && styles.rowSelected)}
				onClick={handleClick}
				onContextMenu={handleContextMenu}
				data-flx="app.channel-thread-list.row"
			>
				<span className={styles.connector} aria-hidden="true" />
				<span className={clsx(styles.name, isMuted && !isSelected && styles.nameMuted)}>{name}</span>
			</button>
		);
	},
);
