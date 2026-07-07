// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import {ChannelChatLayout} from '@app/features/channel/components/ChannelChatLayout';
import {Messages} from '@app/features/channel/components/ChannelMessages';
import {ChannelTextarea} from '@app/features/channel/components/ChannelTextarea';
import {ThreadContextMenu} from '@app/features/channel/components/menus/ThreadContextMenu';
import styles from '@app/features/channel/components/ThreadSidebarPreview.module.css';
import {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import ThreadSidebar from '@app/features/channel/state/ThreadSidebar';
import Threads from '@app/features/channel/state/Threads';
import GatewayConnection from '@app/features/gateway/transport/GatewayConnection';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import Permission from '@app/features/permissions/state/Permission';
import {Button} from '@app/features/ui/button/Button';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import {MAX_MESSAGES_PER_CHANNEL} from '@fluxer/constants/src/LimitConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ArrowSquareOutIcon, DotsThreeIcon, XIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect} from 'react';

const OPEN_FULL_VIEW_DESCRIPTOR = msg({
	message: 'Open full view',
	comment: 'Tooltip on the button that opens the previewed thread in its full channel view.',
});
const CLOSE_THREAD_PREVIEW_DESCRIPTOR = msg({
	message: 'Close thread',
	comment: 'Tooltip on the button that closes the thread preview sidebar panel.',
});
const THREAD_OPTIONS_DESCRIPTOR = msg({
	message: 'Thread options',
	comment: 'Tooltip on the button that opens the thread management menu in the thread preview panel.',
});
const THREAD_DESCRIPTOR = msg({
	message: 'Thread',
	comment: 'Fallback title for the thread preview sidebar when the thread name is not yet known.',
});

interface ThreadSidebarPreviewProps {
	threadId: string;
	parentChannelId: string;
	'data-flx'?: string;
}

export const ThreadSidebarPreview = observer(({threadId, parentChannelId}: ThreadSidebarPreviewProps) => {
	const {i18n} = useLingui();
	const thread = Channels.getChannel(threadId);
	const guildId = thread?.guildId ?? Channels.getChannel(parentChannelId)?.guildId ?? null;

	// Ensure the thread channel exists locally (it may not have been synced yet
	// when the preview card was clicked) and that permissions are computed so the
	// composer is usable.
	useEffect(() => {
		if (Channels.getChannel(threadId)) {
			Permission.handleChannelUpdate(threadId);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const threads = await ThreadCommands.listThreads(parentChannelId);
				if (cancelled) {
					return;
				}
				const wire = threads.find((candidate) => candidate.id === threadId);
				if (wire) {
					Channels.handleChannelCreate({channel: wire});
					Permission.handleChannelUpdate(threadId);
				}
			} catch {
				// Best-effort seed; the panel simply renders empty if it fails.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [threadId, parentChannelId]);

	// While previewing an unjoined thread, ask the gateway for ephemeral access to
	// its live traffic (messages, typing) exactly like the full thread view does.
	useEffect(() => {
		if (!guildId || Threads.isJoined(threadId)) {
			return;
		}
		GatewayConnection.socket?.subscribeThreadPreview({guildId, threadId});
		return () => {
			GatewayConnection.socket?.unsubscribeThreadPreview({guildId, threadId});
		};
	}, [guildId, threadId]);

	// The full message list only auto-fetches for the actively selected channel,
	// so a previewed thread needs an explicit initial load.
	useEffect(() => {
		void MessageCommands.fetchMessages(threadId, null, null, MAX_MESSAGES_PER_CHANNEL);
	}, [threadId]);

	if (!(thread instanceof Channel) || guildId == null) {
		return null;
	}

	const threadName = thread.threadMetadata?.name ?? thread.name ?? i18n._(THREAD_DESCRIPTOR);

	const handleOpenFullView = () => {
		ThreadSidebar.close();
		selectChannel(guildId, threadId);
	};

	const handleOpenMenu = (event: React.MouseEvent) => {
		ContextMenuCommands.openFromEvent(event, ({onClose}) => (
			<ThreadContextMenu
				threadId={threadId}
				threadName={threadName}
				threadState={thread.threadMetadata?.state ?? ThreadStates.OPEN}
				isJoined={Threads.isJoined(threadId)}
				guildId={guildId}
				parentChannelId={parentChannelId}
				onClose={onClose}
				onGoToThread={handleOpenFullView}
			/>
		));
	};

	return (
		<aside className={styles.panel} data-flx="channel.thread-sidebar-preview.panel">
			<header className={styles.header} data-flx="channel.thread-sidebar-preview.header">
				<span className={styles.iconBadge} aria-hidden="true">
					<ThreadIcon size={16} className={styles.icon} data-flx="channel.thread-sidebar-preview.icon" />
				</span>
				<div className={styles.title} title={threadName} data-flx="channel.thread-sidebar-preview.title">
					{threadName}
				</div>
				<div className={styles.actions} data-flx="channel.thread-sidebar-preview.actions">
					<Tooltip text={i18n._(THREAD_OPTIONS_DESCRIPTOR)}>
						<Button
							type="button"
							variant="secondary"
							square
							compact
							fitContent
							icon={<DotsThreeIcon size={18} weight="bold" />}
							onClick={handleOpenMenu}
							aria-label={i18n._(THREAD_OPTIONS_DESCRIPTOR)}
							data-flx="channel.thread-sidebar-preview.button.options"
						/>
					</Tooltip>
					<Tooltip text={i18n._(OPEN_FULL_VIEW_DESCRIPTOR)}>
						<Button
							type="button"
							variant="secondary"
							square
							compact
							fitContent
							icon={<ArrowSquareOutIcon size={18} />}
							onClick={handleOpenFullView}
							aria-label={i18n._(OPEN_FULL_VIEW_DESCRIPTOR)}
							data-flx="channel.thread-sidebar-preview.button.open-full-view"
						/>
					</Tooltip>
					<Tooltip text={i18n._(CLOSE_THREAD_PREVIEW_DESCRIPTOR)}>
						<Button
							type="button"
							variant="secondary"
							square
							compact
							fitContent
							icon={<XIcon size={18} />}
							onClick={() => ThreadSidebar.close()}
							aria-label={i18n._(CLOSE_THREAD_PREVIEW_DESCRIPTOR)}
							data-flx="channel.thread-sidebar-preview.button.close"
						/>
					</Tooltip>
				</div>
			</header>
			<div className={styles.body} data-flx="channel.thread-sidebar-preview.body">
				<ChannelChatLayout
					channel={thread}
					messages={
						<Messages
							key={thread.id}
							channel={thread}
							allowAutoAck={false}
							data-flx="channel.thread-sidebar-preview.messages"
						/>
					}
					textarea={<ChannelTextarea channel={thread} data-flx="channel.thread-sidebar-preview.channel-textarea" />}
					data-flx="channel.thread-sidebar-preview.channel-chat-layout"
				/>
			</div>
		</aside>
	);
});
