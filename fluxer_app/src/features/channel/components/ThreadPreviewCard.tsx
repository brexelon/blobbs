// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import styles from '@app/features/channel/components/ThreadPreviewCard.module.css';
import Channels from '@app/features/channel/state/Channels';
import {Message} from '@app/features/messaging/models/MessagingMessage';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import {http} from '@app/features/platform/transport/RestTransport';
import {Avatar} from '@app/features/ui/components/Avatar';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretRightIcon, ClockIcon} from '@phosphor-icons/react';
import {DateTime} from 'luxon';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const NO_MESSAGES_YET_DESCRIPTOR = msg({
	message: 'No messages yet',
	comment: 'Placeholder in the thread box under a message when the thread has no replies yet.',
});

function useThreadLastMessage(threadId: string | null): Message | null {
	const [lastMessage, setLastMessage] = useState<Message | null>(null);
	useEffect(() => {
		if (!threadId) {
			setLastMessage(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const response = await http.get<Array<WireMessage>>(Endpoints.CHANNEL_MESSAGES(threadId), {
					query: {limit: '1'},
				});
				if (cancelled) {
					return;
				}
				const [wire] = response.body;
				setLastMessage(wire ? new Message(wire) : null);
			} catch {
				// A non-member (preview access lands in a later phase) or an empty thread; the
				// row simply falls back to the "no messages yet" placeholder.
				if (!cancelled) {
					setLastMessage(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [threadId]);
	return lastMessage;
}

function formatCloseLabel(autoCloseAt: string | null | undefined, state: number | undefined): string | null {
	if (state === ThreadStates.ARCHIVED) {
		return null;
	}
	if (!autoCloseAt) {
		return null;
	}
	const closeTime = DateTime.fromISO(autoCloseAt);
	if (!closeTime.isValid) {
		return null;
	}
	const relative = closeTime.toRelative();
	const absolute = closeTime.toLocaleString(DateTime.DATE_MED);
	return relative ? `Closes ${relative} · ${absolute}` : `Closes ${absolute}`;
}

export const ThreadPreviewCard = observer(({message}: {message: Message}) => {
	const {i18n} = useLingui();
	const threadId = message.threadId ?? null;
	const guildId = Channels.getChannel(message.channelId)?.guildId ?? null;
	const thread = threadId ? Channels.getChannel(threadId) : null;
	const threadName = thread?.name ?? message.threadName ?? '';
	const lastMessage = useThreadLastMessage(threadId);
	const closeLabel = formatCloseLabel(thread?.threadMetadata?.auto_close_at, thread?.threadMetadata?.state);
	const handleOpen = async () => {
		if (!threadId || !guildId) {
			return;
		}
		try {
			await ThreadCommands.joinThread(threadId);
		} finally {
			selectChannel(guildId, threadId);
		}
	};
	if (!threadId) {
		return null;
	}
	return (
		<div className={styles.container} data-flx="channel.thread-preview-card">
			<div className={styles.connector} aria-hidden="true" />
			<div className={styles.stack}>
				<button type="button" className={styles.box} onClick={handleOpen} data-flx="channel.thread-preview-card.open">
					<span className={styles.iconBadge} aria-hidden="true">
						<ThreadIcon size={14} className={styles.icon} data-flx="channel.thread-preview-card.icon" />
					</span>
					<div className={styles.body}>
						<div className={styles.header}>
							<span className={styles.name}>{threadName}</span>
						</div>
						<div className={styles.lastMessage}>
							{lastMessage ? (
								<>
									<Avatar user={lastMessage.author} size={16} />
									<span className={styles.lastAuthor}>{lastMessage.author.displayName}:</span>
									<span className={styles.lastContent}>{lastMessage.content}</span>
								</>
							) : (
								<span className={styles.lastContent}>{i18n._(NO_MESSAGES_YET_DESCRIPTOR)}</span>
							)}
						</div>
					</div>
					<CaretRightIcon
						size={16}
						weight="bold"
						className={styles.caret}
						data-flx="channel.thread-preview-card.caret"
					/>
				</button>
				{closeLabel && (
					<div className={styles.footer} data-flx="channel.thread-preview-card.footer">
						<ClockIcon size={13} data-flx="channel.thread-preview-card.footer-icon" />
						<span>{closeLabel}</span>
					</div>
				)}
			</div>
		</div>
	);
});
