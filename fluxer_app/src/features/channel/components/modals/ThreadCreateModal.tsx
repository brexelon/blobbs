// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {useFormSubmit} from '@app/features/app/hooks/useFormSubmit';
import channelCreateStyles from '@app/features/channel/components/modals/ChannelCreateModal.module.css';
import styles from '@app/features/channel/components/modals/ThreadCreateModal.module.css';
import {
	createThread,
	getThreadDefaultValues,
	type ThreadFormInputs,
	threadDurationOptions,
} from '@app/features/channel/utils/ThreadCreateModalUtils';
import {CANCEL_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Form} from '@app/features/ui/components/form/Form';
import {Input} from '@app/features/ui/components/form/FormInput';
import {RadioGroup} from '@app/features/ui/radio_group/RadioGroup';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {Controller, useForm} from 'react-hook-form';

const CREATE_THREAD_DESCRIPTOR = msg({
	message: 'Create Thread',
	comment: 'Title of the create-thread modal. Keep it concise.',
});
const THREAD_NAME_DESCRIPTOR = msg({
	message: 'Thread Name',
	comment: 'Short label in the create-thread modal. Keep it concise.',
});
const THREAD_NAME_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'new-thread',
	comment: 'Placeholder for the thread name input.',
});
const AUTO_CLOSE_DESCRIPTOR = msg({
	message: 'Close after inactivity',
	comment: 'Short label for the thread auto-close duration selector.',
});
const AUTO_CLOSE_SELECTION_DESCRIPTOR = msg({
	message: 'Thread auto-close duration selection',
	comment: 'Accessible label for the thread auto-close duration radio group.',
});

interface ThreadCreateModalProps {
	channelId: string;
	guildId: string;
	message?: Message | null;
}

export const ThreadCreateModal = observer(({channelId, guildId, message}: ThreadCreateModalProps) => {
	const {i18n} = useLingui();
	const form = useForm<ThreadFormInputs>({
		defaultValues: getThreadDefaultValues(),
	});
	const onSubmit = async (data: ThreadFormInputs) => {
		await createThread(channelId, guildId, data, message?.id ?? null);
	};
	const {handleSubmit} = useFormSubmit({
		form,
		onSubmit,
		defaultErrorField: 'name',
	});
	return (
		<Modal.Root size="small" centered data-flx="channel.thread-create-modal.modal-root">
			<Form form={form} onSubmit={handleSubmit} data-flx="channel.thread-create-modal.form.submit">
				<Modal.Header title={i18n._(CREATE_THREAD_DESCRIPTOR)} data-flx="channel.thread-create-modal.modal-header" />
				<Modal.Content data-flx="channel.thread-create-modal.modal-content">
					<Input
						data-flx="channel.thread-create-modal.input.name"
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
					<div
						className={channelCreateStyles.channelTypeSection}
						data-flx="channel.thread-create-modal.duration-section"
					>
						<div className={channelCreateStyles.channelTypeLabel} data-flx="channel.thread-create-modal.duration-label">
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
									data-flx="channel.thread-create-modal.radio-group.duration"
								/>
							)}
							data-flx="channel.thread-create-modal.controller.duration"
						/>
					</div>
					{message != null && (
						<div className={styles.preview} data-flx="channel.thread-create-modal.preview">
							<Avatar user={message.author} size={32} />
							<div className={styles.previewBody} data-flx="channel.thread-create-modal.preview.body">
								<div className={styles.previewAuthor}>{message.author.displayName}</div>
								<div className={styles.previewContent}>{message.content}</div>
							</div>
						</div>
					)}
				</Modal.Content>
				<Modal.Footer data-flx="channel.thread-create-modal.modal-footer">
					<Button onClick={ModalCommands.pop} variant="secondary" data-flx="channel.thread-create-modal.button.cancel">
						{i18n._(CANCEL_DESCRIPTOR)}
					</Button>
					<Button
						type="submit"
						submitting={form.formState.isSubmitting}
						data-flx="channel.thread-create-modal.button.submit"
					>
						{i18n._(CREATE_THREAD_DESCRIPTOR)}
					</Button>
				</Modal.Footer>
			</Form>
		</Modal.Root>
	);
});
