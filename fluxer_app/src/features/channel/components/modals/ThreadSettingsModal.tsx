// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import {SettingsModalHeader} from '@app/features/app/components/dialogs/components/SettingsModalHeader';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {
	SettingsModalContainer,
	SettingsModalDesktopContent,
	SettingsModalDesktopScroll,
	SettingsModalDesktopSidebar,
	SettingsModalSidebarCategory,
	SettingsModalSidebarItem,
	SettingsModalSidebarNav,
} from '@app/features/app/components/dialogs/shared/SettingsModalLayout';
import {useFormSubmit} from '@app/features/app/hooks/useFormSubmit';
import * as ThreadCommands from '@app/features/channel/commands/ThreadCommands';
import overviewStyles from '@app/features/channel/components/modals/channel_tabs/ChannelOverviewTab.module.css';
import {useSlowmodeOptions} from '@app/features/channel/components/modals/channel_tabs/channel_overview_tab/SlowmodeControl';
import styles from '@app/features/channel/components/modals/ThreadSettingsModal.module.css';
import Channels from '@app/features/channel/state/Channels';
import {threadDurationOptions} from '@app/features/channel/utils/ThreadCreateModalUtils';
import guildSettingsStyles from '@app/features/guild/components/modals/GuildSettingsModal.module.css';
import {CANCEL_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import * as UnsavedChangesCommands from '@app/features/ui/commands/UnsavedChangesCommands';
import {Form} from '@app/features/ui/components/form/Form';
import {Combobox, type ComboboxOption} from '@app/features/ui/components/form/FormCombobox';
import {Input} from '@app/features/ui/components/form/FormInput';
import {ThreadIcon} from '@app/features/ui/components/icons/ThreadIcon';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {useUnsavedChangesFlash} from '@app/features/user/hooks/useUnsavedChangesFlash';
import {DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS} from '@fluxer/constants/src/ChannelConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {GearIcon, TrashIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useCallback, useEffect, useMemo} from 'react';
import {Controller, useForm} from 'react-hook-form';

const logger = new Logger('ThreadSettingsModal');

// Each open modal drives one save/reset banner; scope the unsaved-changes state to
// the thread so concurrent settings surfaces never clobber one another.
const overviewTabId = (threadId: string) => `thread-settings-overview-${threadId}`;

const THREAD_SETTINGS_DESCRIPTOR = msg({
	message: 'Thread Settings',
	comment: 'Accessible label for the thread settings modal. Keep it concise.',
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
const THREAD_UPDATED_DESCRIPTOR = msg({
	message: 'Thread updated',
	comment: 'Toast shown after successfully saving thread settings.',
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
	auto_close_duration_seconds: number;
}

export const ThreadSettingsModal = observer(({threadId}: {threadId: string}) => {
	const {i18n} = useLingui();
	const thread = Channels.getChannel(threadId);
	const slowmodeOptions = useSlowmodeOptions();
	const autoCloseOptions = useMemo<Array<ComboboxOption<number>>>(
		() => threadDurationOptions.map((option) => ({value: option.value, label: option.name})),
		[],
	);
	const tabId = overviewTabId(threadId);

	const threadName = thread?.threadMetadata?.name ?? thread?.name ?? '';
	const remoteValues = useMemo<ThreadSettingsInputs>(
		() => ({
			name: threadName,
			slowmode: thread?.rateLimitPerUser ?? 0,
			auto_close_duration_seconds:
				thread?.threadMetadata?.auto_close_duration_seconds ?? DEFAULT_THREAD_AUTO_CLOSE_DURATION_SECONDS,
		}),
		[threadName, thread?.rateLimitPerUser, thread?.threadMetadata?.auto_close_duration_seconds],
	);
	const form = useForm<ThreadSettingsInputs>({defaultValues: remoteValues});

	const onSubmit = useCallback(
		async (data: ThreadSettingsInputs) => {
			const params: ThreadCommands.ThreadUpdateParams = {};
			if (data.name !== remoteValues.name) {
				params.name = data.name;
			}
			const slowmode = Number(data.slowmode);
			if (slowmode !== remoteValues.slowmode) {
				params.rate_limit_per_user = slowmode;
			}
			const autoClose = Number(data.auto_close_duration_seconds);
			if (autoClose !== remoteValues.auto_close_duration_seconds) {
				params.auto_close_duration_seconds = autoClose;
			}
			if (Object.keys(params).length > 0) {
				const updated = await ThreadCommands.updateThread(threadId, params);
				Channels.handleChannelCreate({channel: updated});
				Permission.handleChannelUpdate(threadId);
			}
			// Keep the modal open (like channel settings) and clear the dirty state by
			// re-baselining the form to what was just saved.
			form.reset({name: data.name, slowmode, auto_close_duration_seconds: autoClose});
			ToastCommands.createToast({type: 'success', children: i18n._(THREAD_UPDATED_DESCRIPTOR)});
		},
		[form, i18n, remoteValues, threadId],
	);
	const {handleSubmit: handleSave} = useFormSubmit({form, onSubmit, defaultErrorField: 'name'});
	const handleReset = useCallback(() => {
		form.reset(remoteValues);
	}, [form, remoteValues]);

	const isDirty = form.formState.isDirty;
	const isSubmitting = form.formState.isSubmitting;
	useEffect(() => {
		UnsavedChangesCommands.setUnsavedChanges(tabId, isDirty);
	}, [tabId, isDirty]);
	useEffect(() => {
		UnsavedChangesCommands.setTabData(tabId, {onReset: handleReset, onSave: handleSave, isSubmitting});
	}, [tabId, handleReset, handleSave, isSubmitting]);
	useEffect(() => {
		return () => UnsavedChangesCommands.clearUnsavedChanges(tabId);
	}, [tabId]);
	const {showUnsavedBanner, flashBanner, tabData} = useUnsavedChangesFlash(tabId);

	useEffect(() => {
		if (!thread) {
			ModalCommands.pop();
		}
	}, [thread]);

	const handleClose = useCallback(() => {
		if (isDirty) {
			UnsavedChangesCommands.triggerFlashEffect(tabId);
			return;
		}
		ModalCommands.pop();
	}, [isDirty, tabId]);

	const handleDelete = useCallback(() => {
		ModalCommands.push(
			modal(() => (
				<ConfirmModal
					title={i18n._(DELETE_THREAD_DESCRIPTOR)}
					description={i18n._(DELETE_THREAD_CONFIRM_DESCRIPTOR, {threadName})}
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
	}, [i18n, threadId, threadName]);

	if (!thread) {
		return null;
	}

	const fields = (
		<Form form={form} onSubmit={handleSave} data-flx="channel.thread-settings-modal.form.submit">
			<div className={overviewStyles.sectionWrapper} data-flx="channel.thread-settings-modal.section-wrapper">
				<div className={overviewStyles.settingsGroup} data-flx="channel.thread-settings-modal.settings-group">
					<Input
						data-flx="channel.thread-settings-modal.input.name"
						{...form.register('name')}
						autoComplete="off"
						error={form.formState.errors.name?.message}
						label={i18n._(THREAD_NAME_DESCRIPTOR)}
						maxLength={100}
						minLength={1}
						placeholder={i18n._(THREAD_NAME_PLACEHOLDER_DESCRIPTOR)}
						required={true}
					/>
				</div>
				<div className={overviewStyles.settingsGroup} data-flx="channel.thread-settings-modal.settings-group--2">
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
					<Controller
						name="auto_close_duration_seconds"
						control={form.control}
						render={({field}) => (
							<Combobox
								label={i18n._(AUTO_CLOSE_DESCRIPTOR)}
								value={Number(field.value)}
								options={autoCloseOptions}
								onChange={(value) => field.onChange(value)}
								data-flx="channel.thread-settings-modal.combobox.auto-close"
							/>
						)}
						data-flx="channel.thread-settings-modal.controller.auto-close"
					/>
				</div>
			</div>
		</Form>
	);

	// The narrow mobile experience has no room for the desktop sidebar layout, so
	// fall back to a stacked modal with a footer save bar and a delete action.
	if (MobileLayout.enabled) {
		return (
			<Modal.Root size="small" onClose={handleClose} data-flx="channel.thread-settings-modal.modal-root-mobile">
				<Modal.Header title={i18n._(OVERVIEW_DESCRIPTOR)} data-flx="channel.thread-settings-modal.modal-header" />
				<Modal.Content data-flx="channel.thread-settings-modal.modal-content">
					{fields}
					<div className={styles.dangerZone} data-flx="channel.thread-settings-modal.danger-zone">
						<Button
							type="button"
							variant="danger"
							leftIcon={<TrashIcon size={16} />}
							onClick={handleDelete}
							data-flx="channel.thread-settings-modal.button.delete-mobile"
						>
							{i18n._(DELETE_THREAD_DESCRIPTOR)}
						</Button>
					</div>
				</Modal.Content>
				<Modal.Footer data-flx="channel.thread-settings-modal.modal-footer">
					<Button onClick={handleClose} variant="secondary" data-flx="channel.thread-settings-modal.button.cancel">
						{i18n._(CANCEL_DESCRIPTOR)}
					</Button>
					<Button
						type="button"
						onClick={handleSave}
						submitting={isSubmitting}
						disabled={!isDirty}
						data-flx="channel.thread-settings-modal.button.save-mobile"
					>
						{i18n._(SAVE_CHANGES_DESCRIPTOR)}
					</Button>
				</Modal.Footer>
			</Modal.Root>
		);
	}

	const panelId = 'thread-settings-tabpanel-overview';
	const overviewTabButtonId = 'thread-settings-tab-overview';
	return (
		<Modal.Root size="fullscreen" onClose={handleClose} data-flx="channel.thread-settings-modal.modal-root">
			<Modal.ScreenReaderLabel
				text={i18n._(THREAD_SETTINGS_DESCRIPTOR)}
				data-flx="channel.thread-settings-modal.screen-reader-label"
			/>
			<SettingsModalContainer fullscreen={true} data-flx="channel.thread-settings-modal.settings-modal-container">
				<SettingsModalDesktopSidebar data-flx="channel.thread-settings-modal.settings-modal-desktop-sidebar">
					<div className={guildSettingsStyles.sidebarHeader} data-flx="channel.thread-settings-modal.sidebar-header">
						<div className={guildSettingsStyles.guildName} data-flx="channel.thread-settings-modal.sidebar-title">
							<span
								className={guildSettingsStyles.channelNameWithIcon}
								data-flx="channel.thread-settings-modal.sidebar-name-with-icon"
							>
								<ThreadIcon
									size={16}
									className={guildSettingsStyles.channelNameIcon}
									data-flx="channel.thread-settings-modal.sidebar-icon"
								/>
								<span
									className={guildSettingsStyles.channelNameText}
									data-flx="channel.thread-settings-modal.sidebar-name"
								>
									{threadName}
								</span>
							</span>
						</div>
					</div>
					<SettingsModalSidebarNav data-flx="channel.thread-settings-modal.settings-modal-sidebar-nav">
						<SettingsModalSidebarCategory data-flx="channel.thread-settings-modal.settings-modal-sidebar-category">
							<SettingsModalSidebarItem
								icon={GearIcon}
								label={i18n._(OVERVIEW_DESCRIPTOR)}
								selected={true}
								id={overviewTabButtonId}
								controlsId={panelId}
								data-flx="channel.thread-settings-modal.settings-modal-sidebar-item.overview"
							/>
						</SettingsModalSidebarCategory>
						<SettingsModalSidebarItem
							icon={TrashIcon}
							label={i18n._(DELETE_THREAD_DESCRIPTOR)}
							danger={true}
							onClick={handleDelete}
							data-flx="channel.thread-settings-modal.settings-modal-sidebar-item.delete"
						/>
					</SettingsModalSidebarNav>
				</SettingsModalDesktopSidebar>
				<SettingsModalDesktopContent
					tabpanelId={panelId}
					labelledBy={overviewTabButtonId}
					data-flx="channel.thread-settings-modal.settings-modal-desktop-content"
				>
					<SettingsModalHeader
						title={i18n._(OVERVIEW_DESCRIPTOR)}
						showUnsavedBanner={showUnsavedBanner}
						flashBanner={flashBanner}
						tabData={tabData}
						onClose={handleClose}
						data-flx="channel.thread-settings-modal.settings-modal-header"
					/>
					<SettingsModalDesktopScroll
						scrollKey={`thread-settings-${threadId}`}
						data-flx="channel.thread-settings-modal.settings-modal-desktop-scroll"
					>
						{fields}
					</SettingsModalDesktopScroll>
				</SettingsModalDesktopContent>
			</SettingsModalContainer>
		</Modal.Root>
	);
});
