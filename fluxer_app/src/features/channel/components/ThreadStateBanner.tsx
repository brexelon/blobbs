// SPDX-License-Identifier: AGPL-3.0-or-later

import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import styles from '@app/features/channel/components/ThreadStateBanner.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import {canManageThread, getThreadBannerKind} from '@app/features/channel/utils/ThreadStateUtils';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

const logger = new Logger('ThreadStateBanner');

const LOCKED_DESCRIPTOR = msg({
	message: 'This thread has been locked. Only moderators can send messages.',
	comment: 'Banner at the top of a thread that has been locked by a moderator.',
});
const CLOSED_LOCKED_DESCRIPTOR = msg({
	message: 'This thread has been closed and locked. Only moderators can reopen it.',
	comment: 'Banner at the top of a thread that a moderator manually closed (and thereby locked).',
});
const UNLOCK_DESCRIPTOR = msg({
	message: 'Unlock',
	comment: 'Button on the locked-thread banner that unlocks the thread (moderators only).',
});
const OPEN_DESCRIPTOR = msg({
	message: 'Open',
	comment: 'Button on the closed-and-locked-thread banner that reopens the thread (moderators only).',
});
const ACTION_FAILED_DESCRIPTOR = msg({
	message: 'Something went wrong. Please try again.',
	comment: 'Toast shown when unlocking or reopening a thread from its banner fails.',
});

export const ThreadStateBanner = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const kind = getThreadBannerKind(channel);
	if (kind == null) {
		return null;
	}
	const isClosedLocked = kind === 'closedLocked';
	const canManage = canManageThread(channel);

	const handleAction = async () => {
		try {
			const updated = await ThreadCommands.updateThread(channel.id, {action: isClosedLocked ? 'open' : 'unlock'});
			Channels.handleChannelCreate({channel: updated});
			Permission.handleChannelUpdate(channel.id);
		} catch (error) {
			logger.error(`Failed to ${isClosedLocked ? 'open' : 'unlock'} thread ${channel.id}:`, error);
			ToastCommands.createToast({type: 'error', children: i18n._(ACTION_FAILED_DESCRIPTOR)});
		}
	};

	return (
		<div className={styles.banner} data-flx="channel.thread-state-banner">
			<span className={styles.text}>{i18n._(isClosedLocked ? CLOSED_LOCKED_DESCRIPTOR : LOCKED_DESCRIPTOR)}</span>
			{canManage && (
				<button
					type="button"
					className={styles.action}
					onClick={handleAction}
					data-flx="channel.thread-state-banner.action"
				>
					{i18n._(isClosedLocked ? OPEN_DESCRIPTOR : UNLOCK_DESCRIPTOR)}
				</button>
			)}
		</div>
	);
});
