// SPDX-License-Identifier: AGPL-3.0-or-later

import {MEGAPHONE_NAME} from '@app/features/app/config/I18nDisplayConstants';
import styles from '@app/features/channel/components/ChannelWelcomeSection.module.css';
import {Trans} from '@lingui/react/macro';
import {MegaphoneIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';

/**
 * Intro at the top of the announcements conversation. It explains who writes here,
 * since the viewer never started this conversation and cannot reply to it.
 */
export const MegaphoneWelcomeSection = observer(() => (
	<div className={styles.container} data-flx="channel.direct-message.megaphone-welcome-section.container">
		<div className={clsx('pointer-events-none', styles.channelIcon)}>
			<MegaphoneIcon
				weight="fill"
				className={styles.iconSize}
				data-flx="channel.direct-message.megaphone-welcome-section.icon"
			/>
		</div>
		<h1 className={styles.heading} data-flx="channel.direct-message.megaphone-welcome-section.heading">
			{MEGAPHONE_NAME}
		</h1>
		<p className={styles.description} data-flx="channel.direct-message.megaphone-welcome-section.description">
			<Trans>{MEGAPHONE_NAME} is the place for updates from instance staff.</Trans>
		</p>
	</div>
));
