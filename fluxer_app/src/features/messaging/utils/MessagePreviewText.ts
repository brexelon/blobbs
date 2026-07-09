// SPDX-License-Identifier: AGPL-3.0-or-later

import {MarkdownContext} from '@app/features/messaging/components/markdown/renderers/RendererTypes';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {getParserFlagsForContext} from '@app/features/messaging/utils/markdown/MarkdownParserFlags';
import {parseAndRenderToPlaintext} from '@app/features/messaging/utils/markdown/Plaintext';
import type {I18n} from '@lingui/core';

// A compact, single-line context: enough to resolve mentions and emoji without
// block formatting, matching how an inline reply preview reads.
const PREVIEW_PARSER_FLAGS = getParserFlagsForContext(MarkdownContext.RESTRICTED_INLINE_REPLY);

/**
 * Render a message's content as a one-line preview with mentions resolved to
 * readable text — `<@id>` becomes `@name`, `<@&id>` becomes `@role`, `<#id>`
 * becomes `#channel` — using the message's own channel to resolve guild context.
 * Falls back to the raw content if parsing fails.
 */
export function getMessagePreviewText(message: Message, i18n: I18n): string {
	if (!message.content) {
		return '';
	}
	return parseAndRenderToPlaintext(message.content, PREVIEW_PARSER_FLAGS, {
		channelId: message.channelId,
		preserveMarkdown: false,
		includeEmojiNames: true,
		includeLinkUrls: true,
		mentionChannels: message.mentionChannels,
		i18n,
	});
}
