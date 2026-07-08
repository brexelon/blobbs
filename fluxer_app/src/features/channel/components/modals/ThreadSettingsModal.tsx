// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {useFormSubmit} from '@app/features/app/hooks/useFormSubmit';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import channelCreateStyles from '@app/features/channel/components/modals/ChannelCreateModal.module.css';
import {useSlowmodeOptions} from '@app/features/channel/components/modals/channel_tabs/channel_overview_tab/SlowmodeControl';
import styles from '@app/features/channel/components/modals/ThreadSettingsModal.module.css';
import Channels from '@app/features/channel/state/Channels';
import {threadDurationOptions} from '@app/features/channel/utils/ThreadCreateModalUtils';
import {CANCEL_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Form} from '@app/features/ui/components/form/Form';
import {Combobox} from '@app/features/ui/components/form/FormCombobox';
import {Input} from '@app/features/ui/components/form/FormInput';
import {RadioGroup} from '@app/features/ui/radio_group/RadioGroup';
import {DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS} from '@fluxer/constants/src/ChannelConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {Controller, useForm} from 'react-hook-form';

const logger = new Logger('ThreadSettingsModal');

const EDIT_THREAD_DESCRIPTOR = msg({
	message: 'Edit Thread',
	comment: 'Title of the thread settings modal. Keep it concise.',
});
const OVERVIEW_DESCRIPTOR = msg({
	message: 'Overview',
	comment: 'Tab label for the overview section of the thread settings modal.',
});
const THREAD_NAME_DESCRIPTOR = msg({
	message: 'Thread Name',
	comment: 'Short label in the thread settings modal. Keep it concise.',
});
const THREAD_NAME_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'thread-name',
	comment: 'Placeholder for the thread name input.',
});
const SLOWMODE_DESCRIPTOR = msg({
	message: 'Slowmode',
	comment: 'Short label for the thread slowmode selector.',
});
const AUTO_CLOSE_DESCRIPTOR = msg({
	message: 'Close after inactivity',
	comment: 'Short label for the thread auto-close duration selector.',
});
const AUTO_CLOSE_SELECTION_DESCRIPTOR = msg({
	message: 'Thread auto-close duration selection',
	comment: 'Accessible label for the thread auto-close duration radio group.',
});
const SAVE_CHANGES_DESCRIPTOR = msg({
	message: 'Save Changes',
	comment: 'Submit button in the thread settings modal.',
});
const DELETE_THREAD_DESCRIPTOR = msg({
	message: 'Delete Thread',
	comment: 'Danger button in the thread settings modal that deletes the thread.',
});
const DELETE_THREAD_CONFIRM_DESCRIPTOR = msg({
	message: 'Are you sure you want to delete {threadName}? This cannot be undone.',
	comment: 'Body of the confirmation dialog shown before deleting a thread. {threadName} is inserted by code.',
});
const THREAD_DELETED_DESCRIPTOR = msg({
	message: 'Thread deleted',
	comment: 'Toast shown after successfully deleting a thread.',
});
const THREAD_ACTION_FAILED_DESCRIPTOR = msg({
	message: 'Something went wrong. Please try again.',
	comment: 'Toast shown when a thread management action fails.',
});

interface ThreadSettingsInputs {
	name: string;
	slowmode: number;
	auto_close_duration_seconds: string;
}

export const ThreadSettingsModal = observer(({threadId}: {threadId: string}) => {
	const {i18n} = useLingui();
	const thread = Channels.getChannel(threadId);
	const slowmodeOptions = useSlowmodeOptions();
	const currentName = thread?.threadMetadata?.name ?? thread?.name ?? '';
	const currentSlowmode = thread?.rateLimitPerUser ?? 0;
	const currentAutoClose =
		thread?.threadMetadata?.auto_close_duration_seconds ?? DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS;
	const form = useForm<ThreadSettingsInputs>({
		defaultValues: {
			name: currentName,
			slowmode: currentSlowmode,
			auto_close_duration_seconds: String(currentAutoClose),
		},
	});
	const onSubmit = async (data: ThreadSettingsInputs) => {
		const params: ThreadCommands.ThreadUpdateParams = {};
		if (data.name !== currentName) {
			params.name = data.name;
		}
		const slowmode = Number(data.slowmode);
		if (slowmode !== currentSlowmode) {
			params.rate_limit_per_user = slowmode;
		}
		const autoClose = Number(data.auto_close_duration_seconds);
		if (autoClose !== currentAutoClose) {
			params.auto_close_duration_seconds = autoClose;
		}
		if (Object.keys(params).length > 0) {
			const updated = await ThreadCommands.updateThread(threadId, params);
			Channels.handleChannelCreate({channel: updated});
			Permission.handleChannelUpdate(threadId);
		}
		ModalCommands.pop();
	};
	const {handleSubmit} = useFormSubmit({form, onSubmit, defaultErrorField: 'name'});
	const handleDelete = () => {
		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={i18n._(DELETE_THREAD_DESCRIPTOR)}
					description={i18n._(DELETE_THREAD_CONFIRM_DESCRIPTOR, {threadName: currentName})}
					primaryText={i18n._(DELETE_THREAD_DESCRIPTOR)}
					primaryVariant="danger"
					onPrimary={async () => {
						try {
							await ThreadCommands.deleteThread(threadId);
							ToastCommands.createToast({type: 'success', children: i18n._(THREAD_DELETED_DESCRIPTOR)});
							ModalCommands.pop();
						} catch (error) {
							logger.error(`Failed to delete thread ${threadId}:`, error);
							ToastCommands.createToast({type: 'error', children: i18n._(THREAD_ACTION_FAILED_DESCRIPTOR)});
						}
					}}
					data-flx="channel.thread-settings-modal.delete-confirm-modal"
				/>
			)),
		);
	};
	return (
		<Modal.Root size="small" centered data-flx="channel.thread-settings-modal.modal-root">
			<Form form={form} onSubmit={handleSubmit} data-flx="channel.thread-settings-modal.form.submit">
				<Modal.Header title={i18n._(EDIT_THREAD_DESCRIPTOR)} data-flx="channel.thread-settings-modal.modal-header" />
				<Modal.Content data-flx="channel.thread-settings-modal.modal-content">
					<div className={styles.tabBar} data-flx="channel.thread-settings-modal.tab-bar">
						<span className={styles.tabActive}>{i18n._(OVERVIEW_DESCRIPTOR)}</span>
					</div>
					<Input
						data-flx="channel.thread-settings-modal.input.name"
						{...form.register('name')}
						autoComplete="off"
						autoFocus={true}
						error={form.formState.errors.name?.message}
						label={i18n._(THREAD_NAME_DESCRIPTOR)}
						maxLength={100}
						minLength={1}
						placeholder={i18n._(THREAD_NAME_PLACEHOLDER_DESCRIPTOR)}
						required={true}
					/>
					<Controller
						name="slowmode"
						control={form.control}
						render={({field}) => (
							<Combobox
								label={i18n._(SLOWMODE_DESCRIPTOR)}
								value={Number(field.value)}
								options={slowmodeOptions}
								onChange={(value) => field.onChange(value)}
								data-flx="channel.thread-settings-modal.combobox.slowmode"
							/>
						)}
						data-flx="channel.thread-settings-modal.controller.slowmode"
					/>
					<div
						className={channelCreateStyles.channelTypeSection}
						data-flx="channel.thread-settings-modal.duration-section"
					>
						<div
							className={channelCreateStyles.channelTypeLabel}
							data-flx="channel.thread-settings-modal.duration-label"
						>
							{i18n._(AUTO_CLOSE_DESCRIPTOR)}
						</div>
						<Controller
							name="auto_close_duration_seconds"
							control={form.control}
							render={({field}) => (
								<RadioGroup
									aria-label={i18n._(AUTO_CLOSE_SELECTION_DESCRIPTOR)}
									value={Number(field.value)}
									onChange={(value) => field.onChange(value.toString())}
									options={threadDurationOptions}
									data-flx="channel.thread-settings-modal.radio-group.duration"
								/>
							)}
							data-flx="channel.thread-settings-modal.controller.duration"
						/>
					</div>
					<div className={styles.dangerZone} data-flx="channel.thread-settings-modal.danger-zone">
						<Button
							type="button"
							variant="danger"
							fitContent
							onClick={handleDelete}
							data-flx="channel.thread-settings-modal.button.delete"
						>
							{i18n._(DELETE_THREAD_DESCRIPTOR)}
						</Button>
					</div>
				</Modal.Content>
				<Modal.Footer data-flx="channel.thread-settings-modal.modal-footer">
					<Button
						onClick={ModalCommands.pop}
						variant="secondary"
						data-flx="channel.thread-settings-modal.button.cancel"
					>
						{i18n._(CANCEL_DESCRIPTOR)}
					</Button>
					<Button
						type="submit"
						submitting={form.formState.isSubmitting}
						data-flx="channel.thread-settings-modal.button.submit"
					>
						{i18n._(SAVE_CHANGES_DESCRIPTOR)}
					</Button>
				</Modal.Footer>
			</Form>
		</Modal.Root>
	);
});
