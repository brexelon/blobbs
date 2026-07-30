// SPDX-License-Identifier: AGPL-3.0-or-later

import {MEGAPHONE_NAME} from '@app/features/app/config/I18nDisplayConstants';
import styles from '@app/features/channel/components/direct_message/MegaphoneWelcomeSection.module.css';
import {Trans} from '@lingui/react/macro';
import {MegaphoneIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

/**
 * Intro at the top of the announcements conversation. It explains who writes here,
 * since the viewer never started this conversation and cannot reply to it.
 */
export const MegaphoneWelcomeSection = observer(() => (
	<div className={styles.welcomeSection} data-flx="channel.direct-message.megaphone-welcome-section.welcome-section">
		<div className={styles.icon} aria-hidden="true" data-flx="channel.direct-message.megaphone-welcome-section.icon">
			<MegaphoneIcon
				weight="fill"
				className={styles.iconGlyph}
				data-flx="channel.direct-message.megaphone-welcome-section.icon-glyph"
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
