// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {Message} from '@app/features/messaging/models/MessagingMessage';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {useEffect, useState} from 'react';

export type ThreadOriginMessageState = 'loading' | 'loaded' | 'unavailable';

export interface ThreadOriginMessageResult {
	state: ThreadOriginMessageState;
	message: Message | null;
}

/**
 * Resolves the message a thread was created from (its "starter"). The origin
 * message lives in the parent channel, so it is read from the message store when
 * that channel's page is loaded — keeping edits and deletions live — and
 * otherwise fetched once by id. A 404 (or the store dropping a previously loaded
 * origin) resolves to "unavailable" so callers can fall back.
 */
export function useThreadOriginMessage(
	parentChannelId: string | null,
	originMessageId: string | null,
): ThreadOriginMessageResult {
	const [fetched, setFetched] = useState<{message: Message | null; unavailable: boolean}>({
		message: null,
		unavailable: false,
	});
	// Observe the store's change counter so an edit or deletion of a store-resident
	// origin (which reuses the same id) re-runs resolution and re-renders.
	const version = Messages.version;
	void version;
	const storeMessage =
		parentChannelId && originMessageId ? (Messages.getMessage(parentChannelId, originMessageId) ?? null) : null;
	const storeHasMessage = storeMessage != null;
	useEffect(() => {
		if (!parentChannelId || !originMessageId) {
			setFetched({message: null, unavailable: false});
			return;
		}
		// While the store holds the origin it is authoritative and live; no fetch is
		// needed. When the store loses it (never loaded, or just deleted) this effect
		// re-runs and a one-shot fetch decides between loaded and unavailable.
		if (storeHasMessage) {
			setFetched({message: null, unavailable: false});
			return;
		}
		let cancelled = false;
		void http
			.get<WireMessage>(Endpoints.CHANNEL_MESSAGE(parentChannelId, originMessageId))
			.then((response) => {
				if (cancelled) {
					return;
				}
				setFetched(
					response.body
						? {message: new Message(response.body), unavailable: false}
						: {message: null, unavailable: true},
				);
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				if (error instanceof HttpError && error.status === 404) {
					setFetched({message: null, unavailable: true});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [parentChannelId, originMessageId, storeHasMessage]);
	if (storeMessage) {
		return {state: 'loaded', message: storeMessage};
	}
	if (fetched.message) {
		return {state: 'loaded', message: fetched.message};
	}
	if (fetched.unavailable) {
		return {state: 'unavailable', message: null};
	}
	return {state: 'loading', message: null};
}
