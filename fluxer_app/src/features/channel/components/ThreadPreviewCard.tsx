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
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
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

interface ThreadPreviewData {
	name: string | null;
	autoCloseAt: string | null;
	state: number | null;
	lastMessage: Message | null;
}

/**
 * Resolves the thread's authoritative name + auto-close metadata from the parent
 * channel's thread list (accessible to anyone who can view the channel) and
 * best-effort fetches the thread's latest message for the preview row.
 */
function useThreadPreview(parentChannelId: string, threadId: string | null): ThreadPreviewData {
	const [data, setData] = useState<ThreadPreviewData>({
		name: null,
		autoCloseAt: null,
		state: null,
		lastMessage: null,
	});
	useEffect(() => {
		if (!threadId) {
			setData({name: null, autoCloseAt: null, state: null, lastMessage: null});
			return;
		}
		let cancelled = false;
		void (async () => {
			const [threads, lastWire] = await Promise.all([
				ThreadCommands.listThreads(parentChannelId).catch(() => [] as Array<WireChannel>),
				http
					.get<Array<WireMessage>>(Endpoints.CHANNEL_MESSAGES(threadId), {query: {limit: '1'}})
					.then((response) => response.body[0] ?? null)
					.catch(() => null),
			]);
			if (cancelled) {
				return;
			}
			const threadChannel = threads.find((candidate) => candidate.id === threadId);
			setData({
				name: threadChannel?.thread_metadata?.name ?? threadChannel?.name ?? null,
				autoCloseAt: threadChannel?.thread_metadata?.auto_close_at ?? null,
				state: threadChannel?.thread_metadata?.state ?? null,
				lastMessage: lastWire ? new Message(lastWire) : null,
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [parentChannelId, threadId]);
	return data;
}

function formatCloseLabel(autoCloseAt: string | null, state: number | null): string | null {
	if (state === ThreadStates.ARCHIVED || !autoCloseAt) {
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
	const preview = useThreadPreview(message.channelId, threadId);
	const storeThread = threadId ? Channels.getChannel(threadId) : null;
	const threadName = preview.name ?? storeThread?.name ?? message.threadName ?? '';
	const closeLabel = formatCloseLabel(preview.autoCloseAt, preview.state);
	const lastMessage = preview.lastMessage;
	const handleOpen = async () => {
		if (!threadId || !guildId) {
			return;
		}
		try {
			const joined = await ThreadCommands.joinThread(threadId);
			Channels.handleChannelCreate({channel: joined});
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
						<div className={styles.name}>{threadName}</div>
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
