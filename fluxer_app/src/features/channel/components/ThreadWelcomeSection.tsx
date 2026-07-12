// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/channel/components/ChannelWelcomeSection.module.css';
import {PreloadableUserPopout} from '@app/features/channel/components/PreloadableUserPopout';
import type {Channel} from '@app/features/channel/models/Channel';
import * as ChannelUtils from '@app/features/channel/utils/ChannelUtils';
import GuildMembers from '@app/features/member/state/GuildMembers';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {Trans} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';

/**
 * Thread intro shown at the top of a thread's message list. Unlike a channel's
 * "Welcome to #name" header, a thread shows just its name and, Discord-style, a
 * "Started by <creator>" line where the creator's name carries their role colour
 * and opens their profile on click.
 */
export const ThreadWelcomeSection = observer(({channel}: {channel: Channel}) => {
	const guildId = channel.guildId ?? '';
	const threadName = channel.threadMetadata?.name ?? channel.name ?? '';
	const creatorId = channel.threadMetadata?.creator_id ?? null;
	const creatorUser = creatorId ? Users.getUser(creatorId) : undefined;
	const member = creatorId ? GuildMembers.getMember(guildId, creatorId) : null;
	const creatorColor = member?.getColorString();
	const creatorName = creatorUser
		? NicknameUtils.getNickname(creatorUser, guildId)
		: (channel.threadMetadata?.creator_name ?? '');

	const creatorNode = creatorUser ? (
		<PreloadableUserPopout
			user={creatorUser}
			isWebhook={false}
			guildId={channel.guildId ?? undefined}
			channelId={channel.id}
			enableLongPressActions={true}
			longPressWrapperElement="span"
			data-flx="channel.thread-welcome-section.preloadable-user-popout"
		>
			<span className={styles.startedByName} style={{color: creatorColor}} data-user-id={creatorUser.id}>
				{creatorName}
			</span>
		</PreloadableUserPopout>
	) : (
		<span className={styles.startedByName} style={{color: creatorColor}}>
			{creatorName}
		</span>
	);

	return (
		<div className={styles.container} data-flx="channel.thread-welcome-section.container">
			<div className={clsx('pointer-events-none', styles.channelIcon)}>
				{ChannelUtils.getIcon(channel, {className: styles.iconSize})}
			</div>
			<h1 className={styles.heading} data-flx="channel.thread-welcome-section.heading">
				{threadName}
			</h1>
			{creatorName && (
				<p className={styles.description} data-flx="channel.thread-welcome-section.description">
					<Trans>Started by {creatorNode}</Trans>
				</p>
			)}
		</div>
	);
});
