// SPDX-License-Identifier: AGPL-3.0-or-later

import {MessageGroup} from '@app/features/channel/components/MessageGroup';
import styles from '@app/features/channel/components/ThreadStarterMessage.module.css';
import {TimestampWithTooltip} from '@app/features/channel/components/TimestampWithTooltip';
import {useThreadOriginMessage} from '@app/features/channel/hooks/useThreadOriginMessage';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import messageStyles from '@app/features/theme/styles/Message.module.css';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import UserSettings from '@app/features/user/state/UserSettings';
import * as DateUtils from '@app/features/user/utils/DateFormatting';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';

const STARTER_UNAVAILABLE_DESCRIPTOR = msg({
	message: "Sorry, we couldn't load the first message in this thread",
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
 * Stands in for the starter when the origin message can no longer be loaded. It is
 * shaped like a thread system message — thread icon in the avatar gutter, text, and
 * a timestamp — but has no backing message to render from, so the row is assembled
 * from the shared message grid styles rather than through SystemMessage. The
 * timestamp comes from the origin message's own snowflake, which still encodes when
 * it was posted even though the message itself is gone.
 */
const StarterUnavailableMessage = observer(({originMessageId}: {originMessageId: string}) => {
	const {i18n} = useLingui();
	const messageDisplayCompact = UserSettings.getMessageDisplayCompact();
	const timestampMs = extractTimestamp(originMessageId);
	const timestamp = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
	const formattedDate = timestamp
		? messageDisplayCompact
			? DateUtils.getFormattedTime(timestamp)
			: DateUtils.getRelativeDateString(timestamp, i18n)
		: null;
	const icon = <ThreadIcon size={18} className={messageStyles.systemMessageIconSvg} />;
	const text = <span className={styles.unavailableText}>{i18n._(STARTER_UNAVAILABLE_DESCRIPTOR)}</span>;
	if (messageDisplayCompact) {
		return (
			<div className={messageStyles.messageCompact} data-flx="channel.thread-starter-message.unavailable">
				<div
					className={messageStyles.systemMessageCompactContent}
					data-flx="channel.thread-starter-message.unavailable-compact-content"
				>
					{timestamp && formattedDate && (
						<TimestampWithTooltip date={timestamp} className={messageStyles.messageTimestampCompact}>
							{formattedDate}
						</TimestampWithTooltip>
					)}
					<div className={messageStyles.systemMessageIconCompact}>{icon}</div>
					<div className={messageStyles.systemMessageContentWrapper}>
						<div className={messageStyles.systemMessageContent}>{text}</div>
					</div>
				</div>
			</div>
		);
	}
	return (
		<div className={messageStyles.message} data-flx="channel.thread-starter-message.unavailable">
			<div className={messageStyles.messageGutterLeft} />
			<div className={messageStyles.systemMessageIconWrapper}>{icon}</div>
			<div className={messageStyles.messageGutterRight} />
			<div className={messageStyles.systemMessageContent}>
				{text}{' '}
				{timestamp && formattedDate && (
					<TimestampWithTooltip
						date={timestamp}
						className={clsx(messageStyles.messageTimestamp, messageStyles.systemMessageTimestamp)}
					>
						{formattedDate}
					</TimestampWithTooltip>
				)}
			</div>
		</div>
	);
});

/**
 * Renders the originating message at the top of a message-rooted thread as its
 * starter. Threads created directly (no origin message) render nothing. When the
 * origin can no longer be loaded a system message stands in for it.
 */
export const ThreadStarterMessage = observer(({channel}: {channel: Channel}) => {
	const originMessageId = channel.threadMetadata?.origin_message_id ?? null;
	const parentChannelId = channel.parentId;
	const {state, message} = useThreadOriginMessage(parentChannelId, originMessageId);
	if (!originMessageId || !parentChannelId) {
		return null;
	}
	if (state === 'loading') {
		return null;
	}
	return (
		<div className={styles.starterInList} data-flx="channel.thread-starter-message.starter">
			{state === 'unavailable' || !message ? (
				<StarterUnavailableMessage originMessageId={originMessageId} />
			) : (
				<StarterRow message={message} parentChannelId={parentChannelId} fallbackChannel={channel} />
			)}
		</div>
	);
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
