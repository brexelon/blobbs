// SPDX-License-Identifier: AGPL-3.0-or-later

import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import {EXAMPLE_FLUXER_TAG} from '@app/features/app/config/I18nDisplayConstants';
import {useFormSubmit} from '@app/features/app/hooks/useFormSubmit';
import {
	CANCEL_DESCRIPTOR,
	CONTINUE_DESCRIPTOR,
	USERNAME_DESCRIPTOR,
} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Form} from '@app/features/ui/components/form/Form';
import {Input} from '@app/features/ui/components/form/FormInput';
import {UsernameValidationRules} from '@app/features/ui/components/form/UsernameValidationRules';
import * as UserCommands from '@app/features/user/commands/UserCommands';
import styles from '@app/features/user/components/modals/FluxerTagChangeModal.module.css';
import type {User} from '@app/features/user/models/User';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useCallback, useRef} from 'react';
import {Controller, useForm} from 'react-hook-form';

const USERNAME_ALREADY_TAKEN_DESCRIPTOR = msg({
	message: 'Username already taken',
	comment: 'Short label in the FluxerTag change modal. Keep it concise.',
});
const USERNAME_UPDATED_DESCRIPTOR = msg({
	message: 'Username updated',
	comment: 'Short label in the FluxerTag change modal. Keep it concise.',
});
const CHANGE_USERNAME_FORM_DESCRIPTOR = msg({
	message: 'Change username form',
	comment: 'Short label in the FluxerTag change modal. Keep it concise.',
});
const CHANGE_YOUR_USERNAME_DESCRIPTOR = msg({
	message: 'Change your username',
	comment: 'Short label in the FluxerTag change modal. Keep it concise.',
});

interface FormInputs {
	username: string;
}

interface FluxerTagChangeModalProps {
	user: User;
}

export const FluxerTagChangeModal = observer(({user}: FluxerTagChangeModalProps) => {
	const {i18n} = useLingui();
	const usernameRef = useRef<HTMLInputElement>(null);
	const skipAvailabilityCheckRef = useRef(false);
	const resubmitHandlerRef = useRef<(() => Promise<void>) | null>(null);
	const confirmedRerollRef = useRef(false);
	const form = useForm<FormInputs>({
		defaultValues: {
			username: user.username,
		},
	});
	const onSubmit = useCallback(
		async (data: FormInputs) => {
			const usernameValue = data.username.trim();
			const isSameUsername = usernameValue === user.username.trim();
			if (!skipAvailabilityCheckRef.current && !confirmedRerollRef.current) {
				const usernameTaken = await UserCommands.checkFluxerTagAvailability({username: usernameValue});
				if (usernameTaken && !isSameUsername) {
					ModalCommands.push(
						modal(() => (
							<ConfirmModal
								title={i18n._(USERNAME_ALREADY_TAKEN_DESCRIPTOR)}
								description={
									<div
										className={styles.confirmDescription}
										data-flx="user.fluxer-tag-change-modal.on-submit.confirm-description"
									>
										<p data-flx="user.fluxer-tag-change-modal.on-submit.p">
											<Trans>
												The username{' '}
												<strong data-flx="user.fluxer-tag-change-modal.on-submit.strong">{usernameValue}</strong> is already
												taken. Please choose a different username.
											</Trans>
										</p>
									</div>
								}
								primaryText={i18n._(CONTINUE_DESCRIPTOR)}
								secondaryText={i18n._(CANCEL_DESCRIPTOR)}
								primaryVariant="primary"
								onPrimary={async () => {
									confirmedRerollRef.current = true;
									skipAvailabilityCheckRef.current = true;
									try {
										await resubmitHandlerRef.current?.();
									} finally {
										skipAvailabilityCheckRef.current = false;
									}
								}}
								data-flx="user.fluxer-tag-change-modal.on-submit.confirm-modal"
							/>
						)),
					);
					return;
				}
			}
			await UserCommands.update({username: usernameValue});
			if (skipAvailabilityCheckRef.current) {
				skipAvailabilityCheckRef.current = false;
			}
			ModalCommands.pop();
			ToastCommands.createToast({type: 'success', children: i18n._(USERNAME_UPDATED_DESCRIPTOR)});
		},
		[],
	);
	const {handleSubmit, isSubmitting} = useFormSubmit({
		form,
		onSubmit,
		defaultErrorField: 'username',
	});
	resubmitHandlerRef.current = handleSubmit;
	return (
		<Modal.Root size="small" centered initialFocusRef={usernameRef} data-flx="user.fluxer-tag-change-modal.modal-root">
			<Form
				form={form}
				onSubmit={handleSubmit}
				aria-label={i18n._(CHANGE_USERNAME_FORM_DESCRIPTOR)}
				data-flx="user.fluxer-tag-change-modal.form.submit"
			>
				<Modal.Header
					title={i18n._(CHANGE_YOUR_USERNAME_DESCRIPTOR)}
					data-flx="user.fluxer-tag-change-modal.modal-header"
				/>
				<Modal.Content data-flx="user.fluxer-tag-change-modal.modal-content">
					<Modal.ContentLayout data-flx="user.fluxer-tag-change-modal.modal-content-layout">
						<Modal.Description data-flx="user.fluxer-tag-change-modal.modal-description">
							<Trans>
								Usernames can only contain lowercase letters (a-z), numbers (0-9), underscores, and periods.
							</Trans>
						</Modal.Description>
						<div className={styles.fluxerTagContainer} data-flx="user.fluxer-tag-change-modal.fluxer-tag-container">
							<span className={styles.fluxerTagLabel} data-flx="user.fluxer-tag-change-modal.fluxer-tag-label">
								<Trans>Username</Trans>
							</span>
							{form.formState.errors.username && (
								<div className={styles.errorBox} role="alert" data-flx="user.fluxer-tag-change-modal.error-box">
									{form.formState.errors.username.message}
								</div>
							)}
							<div className={styles.fluxerTagInputRow} data-flx="user.fluxer-tag-change-modal.fluxer-tag-input-row">
								<div className={styles.usernameInput} data-flx="user.fluxer-tag-change-modal.username-input">
									<Controller
										name="username"
										control={form.control}
										render={({field}) => (
											<Input
												data-flx="user.fluxer-tag-change-modal.input.text"
												{...field}
												ref={usernameRef}
												autoComplete="username"
												aria-label={i18n._(USERNAME_DESCRIPTOR)}
												placeholder={EXAMPLE_FLUXER_TAG}
												required={true}
												type="text"
											/>
										)}
										data-flx="user.fluxer-tag-change-modal.controller"
									/>
								</div>
							</div>
							<div className={styles.validationBox} data-flx="user.fluxer-tag-change-modal.validation-box">
								<UsernameValidationRules
									username={form.watch('username')}
									data-flx="user.fluxer-tag-change-modal.username-validation-rules"
								/>
							</div>
						</div>
					</Modal.ContentLayout>
				</Modal.Content>
				<Modal.Footer data-flx="user.fluxer-tag-change-modal.modal-footer">
					<Button onClick={ModalCommands.pop} variant="secondary" data-flx="user.fluxer-tag-change-modal.button.pop">
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit" submitting={isSubmitting} data-flx="user.fluxer-tag-change-modal.button.submit">
						<Trans>Continue</Trans>
					</Button>
				</Modal.Footer>
			</Form>
		</Modal.Root>
	);
});
