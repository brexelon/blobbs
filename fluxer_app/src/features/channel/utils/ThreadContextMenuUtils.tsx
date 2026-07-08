// SPDX-License-Identifier: AGPL-3.0-or-later

import {ThreadContextMenu} from '@app/features/channel/components/menus/ThreadContextMenu';
import Channels from '@app/features/channel/state/Channels';
import Threads from '@app/features/channel/state/Threads';
import {selectChannel} from '@app/features/navigation/commands/NavigationCommands';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import type React from 'react';

/**
 * Opens the shared thread management + notification context menu from any surface
 * that shows a thread (preview cards, the system message, the header, the
 * sidebar). Thread name/state/membership are resolved from the stores so callers
 * only need identifiers.
 */
export function openThreadContextMenu(
	event: React.MouseEvent,
	params: {
		threadId: string;
		parentChannelId: string;
		guildId: string | null;
		onGoToThread?: () => void;
	},
): void {
	const {threadId, parentChannelId, guildId, onGoToThread} = params;
	const channel = Channels.getChannel(threadId);
	const threadName = channel?.threadMetadata?.name ?? channel?.name ?? '';
	const threadState = channel?.threadMetadata?.state ?? ThreadStates.OPEN;
	ContextMenuCommands.openFromEvent(event, ({onClose}) => (
		<ThreadContextMenu
			threadId={threadId}
			threadName={threadName}
			threadState={threadState}
			isJoined={Threads.isJoined(threadId)}
			guildId={guildId}
			parentChannelId={parentChannelId}
			onClose={onClose}
			onGoToThread={onGoToThread ?? (() => guildId && selectChannel(guildId, threadId))}
		/>
	));
}
