// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageGroup} from '@app/features/channel/components/MessageGroup';
import styles from '@app/features/channel/components/ThreadStarterMessage.module.css';
import {useThreadOriginMessage} from '@app/features/channel/hooks/useThreadOriginMessage';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ChatCircleDotsIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

const STARTER_UNAVAILABLE_DESCRIPTOR = msg({
	message: "Sorry, we couldn't load the first message in this thread.",
	comment: 'Fallback shown at the top of a thread when its originating message can no longer be loaded.',
});

/**
 * Renders the origin message the way an ordinary message in the list looks, minus
 * the thread box: the box points at the thread this message started, which is the
 * very thread being displayed. Read-only, since the starter cannot be acted on
 * from inside its own thread.
 */
const StarterRow = observer(({message, parentChannelId, fallbackChannel}: StarterRowProps) => {
	// The origin belongs to the parent channel; render it in that context so author
	// role colours and guild affordances resolve correctly. Fall back to the thread
	// channel if the parent is not in the store.
	const renderChannel = Channels.getChannel(parentChannelId) ?? fallbackChannel;
	return (
		<MessageGroup
			messages={[message]}
			channel={renderChannel}
			readonlyPreview={true}
			hideThreadPreview={true}
			idPrefix="thread-starter"
			data-flx="channel.thread-starter-message.message-group"
		/>
	);
});

interface StarterRowProps {
	message: Message;
	parentChannelId: string;
	fallbackChannel: Channel;
}

/**
 * Renders the originating message at the top of a message-rooted thread as its
 * starter. Threads created directly (no origin message) render nothing. When the
 * origin can no longer be loaded a plain fallback line is shown in its place.
 */
export const ThreadStarterMessage = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const originMessageId = channel.threadMetadata?.origin_message_id ?? null;
	const parentChannelId = channel.parentId;
	const {state, message} = useThreadOriginMessage(parentChannelId, originMessageId);
	if (!originMessageId || !parentChannelId) {
		return null;
	}
	if (state === 'loading') {
		return null;
	}
	if (state === 'unavailable' || !message) {
		return (
			<div className={styles.fallback} data-flx="channel.thread-starter-message.fallback">
				<ChatCircleDotsIcon
					weight="regular"
					className={styles.fallbackIcon}
					data-flx="channel.thread-starter-message.fallback-icon"
				/>
				<span className={styles.fallbackText}>{i18n._(STARTER_UNAVAILABLE_DESCRIPTOR)}</span>
			</div>
		);
	}
	return <StarterRow message={message} parentChannelId={parentChannelId} fallbackChannel={channel} />;
});

/**
 * Preview of the message a thread is about to be created from, shown in the
 * creation panel so the author can see what the thread will grow out of. Renders
 * nothing until the origin resolves, and nothing at all if it cannot be loaded —
 * the panel has no room for an error state, and the thread is not created yet.
 */
export const ThreadStarterPreview = observer(
	({parentChannelId, originMessageId}: {parentChannelId: string; originMessageId: string}) => {
		const {state, message} = useThreadOriginMessage(parentChannelId, originMessageId);
		const parentChannel = Channels.getChannel(parentChannelId);
		if (state !== 'loaded' || !message || !parentChannel) {
			return null;
		}
		return (
			<div className={styles.preview} data-flx="channel.thread-starter-message.preview">
				<StarterRow message={message} parentChannelId={parentChannelId} fallbackChannel={parentChannel} />
			</div>
		);
	},
);
