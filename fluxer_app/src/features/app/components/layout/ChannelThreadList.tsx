// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/app/components/layout/ChannelThreadList.module.css';
import Threads from '@app/features/channel/state/Threads';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
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
	return (
		<div className={styles.list} data-flx="app.channel-thread-list">
			{threads.map((thread) => (
				<ThreadRow
					key={thread.id}
					guildId={guildId}
					threadId={thread.id}
					name={thread.threadMetadata?.name ?? thread.name ?? ''}
					isSelected={selectedChannelId === thread.id}
				/>
			))}
		</div>
	);
});

const ThreadRow = observer(
	({guildId, threadId, name, isSelected}: {guildId: string; threadId: string; name: string; isSelected: boolean}) => {
		const handleClick = useCallback(() => {
			selectChannel(guildId, threadId);
		}, [guildId, threadId]);
		return (
			<button
				type="button"
				className={clsx(styles.row, isSelected && styles.rowSelected)}
				onClick={handleClick}
				data-flx="app.channel-thread-list.row"
			>
				<span className={styles.connector} aria-hidden="true" />
				<ThreadIcon size={16} className={styles.icon} data-flx="app.channel-thread-list.icon" />
				<span className={styles.name}>{name}</span>
			</button>
		);
	},
);
