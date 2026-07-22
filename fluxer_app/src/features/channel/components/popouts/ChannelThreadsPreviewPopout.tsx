// SPDX-License-Identifier: AGPL-3.0-or-later

import {ChannelThreadsPopout} from '@app/features/channel/components/popouts/ChannelThreadsPopout';
import styles from '@app/features/channel/components/popouts/ChannelThreadsPreviewPopout.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import {openThreadFullView} from '@app/features/channel/utils/ThreadNavigationUtils';
import type {Guild} from '@app/features/guild/models/Guild';
import {Avatar} from '@app/features/ui/components/Avatar';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import {openPopout} from '@app/features/ui/popover/PopoverPopout';
import Users from '@app/features/user/state/Users';
import {getShortRelativeTime} from '@app/features/user/utils/DateFormatting';
import {ThreadStates} from '@fluxer/constants/src/ChannelConstants';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {extractTimestamp} from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretRightIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

const HEADER_DESCRIPTOR = msg({
	message: 'More Active Threads',
	comment: 'Header of the hover popout that lists a channel’s recently active (closed) threads.',
});
const SEE_ALL_DESCRIPTOR = msg({
	message: 'See All',
	comment: 'Row at the bottom of the active-threads hover popout that opens the full thread list.',
});

const MAX_PREVIEW_THREADS = 3;

const threadName = (thread: WireChannel): string => thread.thread_metadata?.name ?? thread.name ?? '';

function activityTimestamp(thread: WireChannel): number {
	const referenceId = thread.last_message_id ?? thread.id;
	const timestamp = extractTimestamp(referenceId);
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Filter a channel's thread list down to the closed (but not locked) threads,
 * ordered by most recent activity, and capped for the hover preview. Closed
 * threads are the ones that have dropped out of the sidebar, so surfacing the
 * most recently active few mirrors Discord's "More Active Threads" affordance.
 */
export function selectPreviewThreads(threads: ReadonlyArray<WireChannel>): ReadonlyArray<WireChannel> {
	return threads
		.filter((thread) => {
			const state = thread.thread_metadata?.state ?? ThreadStates.OPEN;
			const locked = thread.thread_metadata?.locked ?? false;
			return state === ThreadStates.CLOSED && !locked;
		})
		.slice()
		.sort((a, b) => activityTimestamp(b) - activityTimestamp(a))
		.slice(0, MAX_PREVIEW_THREADS);
}

interface ChannelThreadsPreviewPopoutProps {
	guild: Guild;
	channel: Channel;
	threads: ReadonlyArray<WireChannel>;
	getAnchor: () => HTMLElement | null;
	onClose: () => void;
}

export const ChannelThreadsPreviewPopout = observer(
	({guild, channel, threads, getAnchor, onClose}: ChannelThreadsPreviewPopoutProps) => {
		const {i18n} = useLingui();
		const guildId = channel.guildId ?? guild.id;

		const handleOpenThread = (thread: WireChannel) => {
			onClose();
			void openThreadFullView({guildId, threadId: thread.id, parentChannelId: channel.id});
		};

		const handleSeeAll = () => {
			onClose();
			const anchor = getAnchor();
			if (!anchor) {
				return;
			}
			openPopout(
				anchor,
				{
					position: 'right-start',
					animationType: 'smooth',
					render: ({onClose: closeFull}) => (
						<ChannelThreadsPopout
							channel={channel}
							onClose={closeFull}
							data-flx="channel.channel-threads-preview-popout.channel-threads-popout"
						/>
					),
				},
				`channel-threads-full:${channel.id}`,
			);
		};

		return (
			<div className={styles.container} data-flx="channel.channel-threads-preview-popout.container">
				<div className={styles.header} data-flx="channel.channel-threads-preview-popout.header">
					{i18n._(HEADER_DESCRIPTOR)}
				</div>
				<div className={styles.list} data-flx="channel.channel-threads-preview-popout.list">
					{threads.map((thread) => {
						const name = threadName(thread);
						const creatorId = thread.thread_metadata?.creator_id ?? null;
						const creatorUser = creatorId ? Users.getUser(creatorId) : undefined;
						const relative = getShortRelativeTime(activityTimestamp(thread));
						return (
							<button
								key={thread.id}
								type="button"
								className={styles.row}
								onClick={() => handleOpenThread(thread)}
								data-flx="channel.channel-threads-preview-popout.row"
							>
								<div className={styles.avatar} data-flx="channel.channel-threads-preview-popout.avatar">
									{creatorUser ? (
										<Avatar user={creatorUser} size={24} guildId={guildId} showOffline={false} />
									) : (
										<div className={styles.avatarFallback} aria-hidden="true">
											<ThreadIcon size={16} />
										</div>
									)}
								</div>
								<span className={styles.name} title={name}>
									{name}
								</span>
								{relative && <span className={styles.time}>{relative}</span>}
							</button>
						);
					})}
					<button
						type="button"
						className={styles.seeAllRow}
						onClick={handleSeeAll}
						data-flx="channel.channel-threads-preview-popout.see-all"
					>
						<div className={styles.seeAllIcon} aria-hidden="true">
							<ThreadIcon size={16} />
						</div>
						<span className={styles.seeAllLabel}>{i18n._(SEE_ALL_DESCRIPTOR)}</span>
						<CaretRightIcon size={14} weight="bold" className={styles.seeAllCaret} />
					</button>
				</div>
			</div>
		);
	},
);
