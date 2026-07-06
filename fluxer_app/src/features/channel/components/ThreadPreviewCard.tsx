// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import styles from '@app/features/channel/components/ThreadPreviewCard.module.css';
import Channels from '@app/features/channel/state/Channels';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

const VIEW_THREAD_DESCRIPTOR = msg({
	message: 'View thread',
	comment: 'Affordance shown on the thread box under the message a thread was started from.',
});

export const ThreadPreviewCard = observer(({message}: {message: Message}) => {
	const {i18n} = useLingui();
	const threadId = message.threadId ?? null;
	const guildId = Channels.getChannel(message.channelId)?.guildId ?? null;
	const thread = threadId ? Channels.getChannel(threadId) : null;
	const threadName = thread?.name ?? message.threadName ?? '';
	const handleOpen = useCallback(async () => {
		if (!threadId || !guildId) {
			return;
		}
		try {
			await ThreadCommands.joinThread(threadId);
		} finally {
			selectChannel(guildId, threadId);
		}
	}, [threadId, guildId]);
	if (!threadId) {
		return null;
	}
	return (
		<div className={styles.container} data-flx="channel.thread-preview-card">
			<div className={styles.connector} aria-hidden="true" />
			<button type="button" className={styles.box} onClick={handleOpen} data-flx="channel.thread-preview-card.open">
				<ThreadIcon size={16} className={styles.icon} data-flx="channel.thread-preview-card.icon" />
				<span className={styles.name}>{threadName}</span>
				<span className={styles.action}>{i18n._(VIEW_THREAD_DESCRIPTOR)}</span>
			</button>
		</div>
	);
});
