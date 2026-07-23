// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/channel/components/ThreadCreatePanel.module.css';
import ThreadSidebar from '@app/features/channel/state/ThreadSidebar';
import {submitThreadCreate} from '@app/features/channel/utils/ThreadCreateFlow';
import {CLOSE_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {Input} from '@app/features/ui/components/form/FormInput';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {MAX_MESSAGE_LENGTH_PREMIUM} from '@fluxer/constants/src/LimitConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {XIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useRef, useState} from 'react';

const logger = new Logger('ThreadCreatePanel');

const NEW_THREAD_DESCRIPTOR = msg({
	message: 'New Thread',
	comment: 'Title of the thread-creation panel that slides in beside a channel.',
});
const THREAD_NAME_DESCRIPTOR = msg({
	message: 'Thread Name (Optional)',
	comment: 'Label for the optional thread-name field in the thread-creation panel.',
});
const THREAD_NAME_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'New Thread',
	comment: 'Placeholder shown in the thread-name field of the thread-creation panel.',
});
const STARTER_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Enter a message to start the conversation!',
	comment: 'Placeholder for the required starter-message field in the thread-creation panel.',
});
const STARTER_REQUIRED_DESCRIPTOR = msg({
	message: 'Starter Message is required',
	comment: 'Validation error shown when the thread-creation starter message is empty.',
});

interface ThreadCreatePanelProps {
	parentChannelId: string;
	guildId: string;
	originMessageId?: string | null;
	/** Full-screen presentation used on the mobile layout. */
	fullScreen?: boolean;
	'data-flx'?: string;
}

export const ThreadCreatePanel = observer(
	({parentChannelId, guildId, originMessageId, fullScreen}: ThreadCreatePanelProps) => {
		const {i18n} = useLingui();
		const [name, setName] = useState('');
		const [content, setContent] = useState('');
		const [starterError, setStarterError] = useState(false);
		const [submitting, setSubmitting] = useState(false);
		const contentRef = useRef<HTMLTextAreaElement | null>(null);

		const submit = useCallback(async () => {
			if (submitting) {
				return;
			}
			if (!content.trim()) {
				setStarterError(true);
				contentRef.current?.focus();
				return;
			}
			setSubmitting(true);
			try {
				await submitThreadCreate({parentChannelId, guildId, name, content: content.trim(), originMessageId});
			} catch (error) {
				logger.error('Failed to create thread:', error);
				setSubmitting(false);
			}
		}, [submitting, content, name, parentChannelId, guildId, originMessageId]);

		const handleContentKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					void submit();
				}
			},
			[submit],
		);

		return (
			<aside
				className={fullScreen ? styles.panelFullScreen : styles.panel}
				data-flx="channel.thread-create-panel.panel"
			>
				<header className={styles.header} data-flx="channel.thread-create-panel.header">
					<span className={styles.iconBadge} aria-hidden="true">
						<ThreadIcon size={16} className={styles.icon} />
					</span>
					<span className={styles.title}>{i18n._(NEW_THREAD_DESCRIPTOR)}</span>
					<Tooltip text={i18n._(CLOSE_DESCRIPTOR)}>
						<FocusRing offset={-2}>
							<button
								type="button"
								className={styles.closeButton}
								onClick={() => ThreadSidebar.close()}
								aria-label={i18n._(CLOSE_DESCRIPTOR)}
								data-flx="channel.thread-create-panel.close"
							>
								<XIcon size={18} />
							</button>
						</FocusRing>
					</Tooltip>
				</header>
				<div className={styles.body} data-flx="channel.thread-create-panel.body">
					<Input
						label={i18n._(THREAD_NAME_DESCRIPTOR)}
						value={name}
						onChange={(event) => setName(event.target.value)}
						autoComplete="off"
						autoFocus={true}
						maxLength={100}
						placeholder={i18n._(THREAD_NAME_PLACEHOLDER_DESCRIPTOR)}
						data-flx="channel.thread-create-panel.name"
					/>
				</div>
				<div className={styles.composer} data-flx="channel.thread-create-panel.composer">
					{starterError && (
						<div className={styles.errorLabel} role="alert" data-flx="channel.thread-create-panel.error">
							{i18n._(STARTER_REQUIRED_DESCRIPTOR)}
						</div>
					)}
					<div
						className={starterError ? styles.starterBoxError : styles.starterBox}
						data-flx="channel.thread-create-panel.starter-box"
					>
						<textarea
							ref={contentRef}
							className={styles.starterTextarea}
							value={content}
							onChange={(event) => {
								setContent(event.target.value);
								if (starterError && event.target.value.trim()) {
									setStarterError(false);
								}
							}}
							onKeyDown={handleContentKeyDown}
							placeholder={i18n._(STARTER_PLACEHOLDER_DESCRIPTOR)}
							maxLength={MAX_MESSAGE_LENGTH_PREMIUM}
							rows={1}
							disabled={submitting}
							aria-label={i18n._(STARTER_PLACEHOLDER_DESCRIPTOR)}
							data-flx="channel.thread-create-panel.starter-textarea"
						/>
					</div>
				</div>
			</aside>
		);
	},
);
