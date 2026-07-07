// SPDX-License-Identifier: AGPL-3.0-or-later

import {SystemMessage} from '@app/features/channel/components/SystemMessage';
import {SystemMessageUsername} from '@app/features/channel/components/SystemMessageUsername';
import {useSystemMessageData} from '@app/features/messaging/hooks/useSystemMessageData';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {ComponentDispatch} from '@app/features/platform/utils/ComponentBus';
import styles from '@app/features/theme/styles/Message.module.css';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {Trans} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

interface ThreadCreatedMessageProps {
	message: Message;
}

export const ThreadCreatedMessage = observer(({message}: ThreadCreatedMessageProps) => {
	const {author, channel, guild} = useSystemMessageData(message);
	const threadId = message.threadId ?? null;
	const threadName = message.threadName ?? '';
	const openThread = useCallback(() => {
		if (threadId && channel?.guildId) {
			selectChannel(channel.guildId, threadId);
		}
	}, [threadId, channel?.guildId]);
	const openThreads = useCallback(() => {
		ComponentDispatch.dispatch('CHANNEL_THREADS_OPEN');
	}, []);
	if (!channel) {
		return null;
	}
	const messageContent = (
		<Trans>
			<SystemMessageUsername
				key={author.id}
				author={author}
				guild={guild}
				message={message}
				data-flx="channel.thread-created-message.system-message-username"
			/>{' '}
			started a thread:{' '}
			<button
				key={`thread-${message.id}`}
				type="button"
				className={styles.systemMessageLink}
				onClick={openThread}
				data-flx="channel.thread-created-message.system-message-link.open-thread.button"
			>
				{threadName}
			</button>
			. See all{' '}
			<button
				key={`threads-${message.id}`}
				type="button"
				className={styles.systemMessageLink}
				onClick={openThreads}
				data-flx="channel.thread-created-message.system-message-link.open-threads.button"
			>
				threads
			</button>
			.
		</Trans>
	);
	return (
		<SystemMessage
			iconNode={<ThreadIcon size={18} data-flx="channel.thread-created-message.thread-icon" />}
			message={message}
			messageContent={messageContent}
			data-flx="channel.thread-created-message.system-message"
		/>
	);
});
