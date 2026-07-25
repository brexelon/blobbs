// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {MessageGroup} from '@app/features/channel/components/MessageGroup';
import styles from '@app/features/channel/components/ThreadStarterMessage.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import {Message} from '@app/features/messaging/models/MessagingMessage';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {http} from '@app/features/platform/transport/RestTransport';
import {HttpError} from '@app/features/platform/types/EndpointError';
import type {Message as WireMessage} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ChatCircleDotsIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const STARTER_UNAVAILABLE_DESCRIPTOR = msg({
	message: "Sorry, we couldn't load the first message in this thread.",
	comment: 'Fallback shown at the top of a thread when its originating message can no longer be loaded.',
});

type StarterState = 'loading' | 'loaded' | 'unavailable';

interface StarterResult {
	state: StarterState;
	message: Message | null;
}

/**
 * Resolves the message a thread was created from (its "starter"). The origin
 * message lives in the parent channel, so it is read from the message store when
 * that channel's page is loaded — keeping edits and deletions live — and
 * otherwise fetched once by id. A 404 (or the store dropping a previously loaded
 * origin) resolves to "unavailable" so the caller can show the fallback.
 */
function useOriginMessage(parentChannelId: string | null, originMessageId: string | null): StarterResult {
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

/**
 * Renders the originating message at the top of a message-rooted thread as its
 * starter. Threads created directly (no origin message) render nothing. When the
 * origin can no longer be loaded a plain fallback line is shown in its place.
 */
export const ThreadStarterMessage = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const originMessageId = channel.threadMetadata?.origin_message_id ?? null;
	const parentChannelId = channel.parentId;
	const {state, message} = useOriginMessage(parentChannelId, originMessageId);
	if (!originMessageId || !parentChannelId) {
		return null;
	}
	// The origin belongs to the parent channel; render it in that context so author
	// role colours and guild affordances resolve correctly. Fall back to the thread
	// channel if the parent is not in the store.
	const renderChannel = Channels.getChannel(parentChannelId) ?? channel;
	if (state === 'loading') {
		return null;
	}
	if (state === 'unavailable' || !message) {
		return (
			<div className={styles.fallback} data-flx="channel.thread-starter-message.fallback">
				<ChatCircleDotsIcon
					weight="regular"
					className={styles.fallbackIcon}
					data-flx="channel.thread-starter-message.fallback-icon"
				/>
				<span className={styles.fallbackText}>{i18n._(STARTER_UNAVAILABLE_DESCRIPTOR)}</span>
			</div>
		);
	}
	return (
		<div className={styles.starter} data-flx="channel.thread-starter-message.starter">
			<MessageGroup
				messages={[message]}
				channel={renderChannel}
				readonlyPreview={true}
				idPrefix="thread-starter"
				data-flx="channel.thread-starter-message.message-group"
			/>
		</div>
	);
});
