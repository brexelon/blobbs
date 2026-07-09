// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/channel/components/RecipientRemoveMessage.module.css';
import {SystemMessage} from '@app/features/channel/components/SystemMessage';
import {SystemMessageUsername} from '@app/features/channel/components/SystemMessageUsername';
import {useSystemMessageData} from '@app/features/messaging/hooks/useSystemMessageData';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Users from '@app/features/user/state/Users';
import {Trans} from '@lingui/react/macro';
import {UserMinusIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

interface ThreadMemberRemoveMessageProps {
	message: Message;
}

export const ThreadMemberRemoveMessage = observer(({message}: ThreadMemberRemoveMessageProps) => {
	const {author, channel, guild} = useSystemMessageData(message);
	const removedUserId = message.mentions.length > 0 ? message.mentions[0].id : null;
	const removedUser = Users.getUser(removedUserId ?? '');
	if (!channel) {
		return null;
	}
	const messageContent = removedUser ? (
		<Trans>
			<SystemMessageUsername
				key={author.id}
				author={author}
				guild={guild}
				message={message}
				data-flx="channel.thread-member-remove-message.system-message-username"
			/>{' '}
			removed{' '}
			<SystemMessageUsername
				key={removedUser.id}
				author={removedUser}
				guild={guild}
				message={message}
				data-flx="channel.thread-member-remove-message.system-message-username--2"
			/>{' '}
			from the thread.
		</Trans>
	) : (
		<Trans>
			<SystemMessageUsername
				key={author.id}
				author={author}
				guild={guild}
				message={message}
				data-flx="channel.thread-member-remove-message.system-message-username--3"
			/>{' '}
			removed someone from the thread.
		</Trans>
	);
	return (
		<SystemMessage
			icon={UserMinusIcon}
			iconWeight="bold"
			iconClassname={styles.icon}
			message={message}
			messageContent={messageContent}
			data-flx="channel.thread-member-remove-message.system-message"
		/>
	);
});
