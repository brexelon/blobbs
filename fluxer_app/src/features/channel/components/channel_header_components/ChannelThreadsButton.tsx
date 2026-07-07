// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/channel/components/ChannelHeader.module.css';
import {ChannelThreadsPopout} from '@app/features/channel/components/popouts/ChannelThreadsPopout';
import type {Channel} from '@app/features/channel/models/Channel';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {usePopout} from '@app/features/ui/hooks/usePopout';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';

const THREADS_DESCRIPTOR = msg({
	message: 'Threads',
	comment: 'Channel header button that opens the list of threads in this channel. Keep it concise.',
});

interface ChannelThreadsButtonProps {
	channel: Channel;
}

export const ChannelThreadsButton = observer(({channel}: ChannelThreadsButtonProps) => {
	const {i18n} = useLingui();
	const {isOpen, openProps} = usePopout('channel-threads');
	const threadsLabel = i18n._(THREADS_DESCRIPTOR);
	return (
		<Popout
			data-flx="channel.channel-header-components.channel-threads-button.popout"
			{...openProps}
			render={({onClose}) => (
				<ChannelThreadsPopout
					channel={channel}
					onClose={onClose}
					data-flx="channel.channel-header-components.channel-threads-button.channel-threads-popout"
				/>
			)}
			position="bottom-end"
		>
			<Tooltip
				text={threadsLabel}
				position="bottom"
				data-flx="channel.channel-header-components.channel-threads-button.tooltip"
			>
				<FocusRing offset={-2} data-flx="channel.channel-header-components.channel-threads-button.focus-ring">
					<button
						type="button"
						className={isOpen ? styles.iconButtonSelected : styles.iconButtonDefault}
						aria-label={threadsLabel}
						aria-haspopup={true}
						aria-expanded={isOpen}
						data-flx="channel.channel-header-components.channel-threads-button.button"
					>
						<ThreadIcon
							size={24}
							className={styles.buttonIcon}
							data-flx="channel.channel-header-components.channel-threads-button.icon"
						/>
					</button>
				</FocusRing>
			</Tooltip>
		</Popout>
	);
});
