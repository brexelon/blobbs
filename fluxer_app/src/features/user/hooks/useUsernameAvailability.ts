// SPDX-License-Identifier: AGPL-3.0-or-later

import * as AuthenticationCommands from '@app/features/auth/commands/AuthenticationCommands';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {useEffect, useRef, useState} from 'react';

const logger = new Logger('useUsernameAvailability');

export type UsernameAvailabilityStatus = 'idle' | 'checking' | 'available' | 'unavailable';

interface UseUsernameAvailabilityOptions {
	username: string;
	/** Set false while the field is empty or fails local format checks, so no request is made. */
	enabled: boolean;
	debounceMs?: number;
}

/**
 * Reports whether a username is free, for live feedback under the registration field.
 *
 * The answer is only ever advisory: registration re-checks availability, and a name can
 * be taken between the check and the submit.
 */
export function useUsernameAvailability({username, enabled, debounceMs = 400}: UseUsernameAvailabilityOptions) {
	const [status, setStatus] = useState<UsernameAvailabilityStatus>('idle');
	const abortControllerRef = useRef<AbortController | null>(null);
	useEffect(() => {
		abortControllerRef.current?.abort();
		abortControllerRef.current = null;
		const trimmed = username?.trim() ?? '';
		if (!enabled || trimmed.length === 0) {
			setStatus('idle');
			return;
		}
		setStatus('checking');
		const timer = setTimeout(async () => {
			const controller = new AbortController();
			abortControllerRef.current = controller;
			try {
				const available = await AuthenticationCommands.checkUsernameAvailability(trimmed, controller.signal);
				if (controller.signal.aborted) return;
				setStatus(available ? 'available' : 'unavailable');
			} catch (error) {
				if (controller.signal.aborted) return;
				// Say nothing rather than guess: a failed check is not evidence either way.
				logger.debug('Failed to check username availability', error);
				setStatus('idle');
			}
		}, debounceMs);
		return () => {
			clearTimeout(timer);
			abortControllerRef.current?.abort();
			abortControllerRef.current = null;
		};
	}, [username, enabled, debounceMs]);
	return {status};
}
