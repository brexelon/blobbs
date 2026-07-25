// SPDX-License-Identifier: AGPL-3.0-or-later

import {MEGAPHONE_NAME} from '@app/features/app/config/I18nDisplayConstants';
import * as PrivateChannelCommands from '@app/features/channel/commands/PrivateChannelCommands';
import styles from '@app/features/channel/components/direct_message/DirectMessageList.module.css';
import Channels from '@app/features/channel/state/Channels';
import {isSystemDmChannel} from '@app/features/channel/utils/ChannelUtils';
import ReadStates from '@app/features/read_state/state/ReadStates';
import * as LayoutCommands from '@app/features/ui/commands/LayoutCommands';
import {MentionBadge} from '@app/features/ui/components/MentionBadge';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {FLUXERBOT_ID} from '@fluxer/constants/src/AppConstants';
import {MegaphoneIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

/**
 * The announcements conversation the instance's staff write to. It is pinned above
 * the direct message list rather than listed among them, since it is not a
 * conversation the viewer chose to start, and it is always present so announcements
 * have a fixed home — opening it creates the channel if the first one has not
 * arrived yet.
 */
function useMegaphoneChannelId(): string | null {
	const channel = Channels.getPrivateChannels().find((candidate) => isSystemDmChannel(candidate));
	return channel?.id ?? null;
}

function useOpenMegaphone(): () => void {
	return useCallback(() => {
		void PrivateChannelCommands.openDMChannel(FLUXERBOT_ID);
		if (MobileLayout.isMobileLayout()) {
			LayoutCommands.updateMobileLayoutState(false, true);
		}
	}, []);
}

export const MegaphoneDmItem = observer(({isSelected}: {isSelected: boolean}) => {
	const channelId = useMegaphoneChannelId();
	const openMegaphone = useOpenMegaphone();
	const mentionCount = channelId ? ReadStates.getMentionCount(channelId) : 0;
	return (
		<FocusRing offset={-2} data-flx="channel.direct-message.megaphone-dm-item.focus-ring">
			<button
				type="button"
				className={isSelected ? styles.clickableItemSelected : styles.clickableItem}
				onClick={openMegaphone}
				aria-label={MEGAPHONE_NAME}
				data-flx="channel.direct-message.megaphone-dm-item.button"
			>
				<div
					className={styles.clickableItemInner}
					data-flx="channel.direct-message.megaphone-dm-item.clickable-item-inner"
				>
					<div
						className={styles.clickableItemContent}
						data-flx="channel.direct-message.megaphone-dm-item.clickable-item-content"
					>
						<div
							className={styles.clickableItemIcon}
							data-flx="channel.direct-message.megaphone-dm-item.clickable-item-icon"
						>
							<MegaphoneIcon
								weight="fill"
								className={styles.iconSize5}
								data-flx="channel.direct-message.megaphone-dm-item.icon"
							/>
						</div>
						<span
							className={styles.clickableItemText}
							data-flx="channel.direct-message.megaphone-dm-item.clickable-item-text"
						>
							{MEGAPHONE_NAME}
						</span>
					</div>
					<MentionBadge mentionCount={mentionCount} data-flx="channel.direct-message.megaphone-dm-item.mention-badge" />
				</div>
			</button>
		</FocusRing>
	);
});
