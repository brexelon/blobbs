// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import {UNKNOWN_CHANNEL_DESCRIPTOR} from '@app/features/channel/utils/ChannelMessageDescriptors';
import styles from '@app/features/guild/components/modals/guild_tabs/GuildAuditLogTab.module.css';
import {ClickableUser, CopyIdInline} from '@app/features/guild/components/modals/guild_tabs/GuildAuditLogTabComponents';
import type {AuditLogTargetType} from '@app/features/guild/components/modals/guild_tabs/GuildAuditLogTabConstants';
import {
	type ChangeShapeWithUnknowns,
	formatDateStringValue,
	getChannelTypeLabel,
	isBasicRecord,
	isEmptyString,
	looksLikeSnowflake,
	resolveIdToName,
	safeScalarString,
	shouldHideChangeKey,
	toChangeShape,
} from '@app/features/guild/utils/guild_tabs/GuildAuditLogTabUtils';
import type {ComboboxOption} from '@app/features/ui/components/form/FormCombobox';
import type {User} from '@app/features/user/models/User';
import {getFormattedDateTime} from '@app/features/user/utils/DateFormatting';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {AuditLogActionType} from '@fluxer/constants/src/AuditLogActionType';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import type {AuditLogChange, GuildAuditLogEntryResponse} from '@fluxer/schema/src/domains/guild/GuildAuditLogSchemas';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';
import type {I18n} from '@lingui/core';
import {msg, plural} from '@lingui/core/macro';
import {Plural, Trans} from '@lingui/react/macro';
import type React from 'react';

const SOMETHING_DESCRIPTOR = msg({
	message: 'something',
	comment: 'Lowercase fallback label in the activity log when an entity name is missing.',
});
const UNKNOWN_ENTITY_DESCRIPTOR = msg({
	message: 'unknown entity',
	comment: 'Lowercase fallback label in the activity log for an entity that cannot be resolved.',
});
const SOMEONE_DESCRIPTOR = msg({
	message: 'someone',
	comment: 'Lowercase fallback label in the activity log when the actor or user is unknown.',
});
const NOTHING_DESCRIPTOR = msg({
	message: 'nothing',
	comment: 'Lowercase fallback label in the activity log for an empty or missing value.',
});
const DETAILS_DESCRIPTOR = msg({
	message: 'details',
	comment: 'Lowercase fallback label in the activity log when a changed field has no friendly name.',
});
const VALUE_DESCRIPTOR = msg({
	message: 'value',
	comment: 'Lowercase fallback label in the activity log for a generic changed value.',
});
const UNKNOWN_TARGET_DESCRIPTOR = msg({
	message: 'Unknown target',
	comment: 'Activity log fallback label for a target object that cannot be resolved.',
});
export const shouldNotRenderChangeDetail = (targetType: AuditLogTargetType, changeKey: string): boolean =>
	shouldHideChangeKey(targetType, changeKey);
const looksLikeHexColor = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);
const renderEntityInline = (label: string, guildId: string | undefined, i18n: I18n): React.ReactNode => {
	if (!label)
		return (
			<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entity-inline.strong">
				{i18n._(SOMETHING_DESCRIPTOR)}
			</strong>
		);
	if (looksLikeSnowflake(label) && guildId) {
		const name = resolveIdToName(label, guildId);
		if (name)
			return (
				<CopyIdInline
					id={label}
					data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entity-inline.copy-id-inline"
				>
					<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entity-inline.strong--2">{name}</strong>
				</CopyIdInline>
			);
	}
	if (looksLikeSnowflake(label))
		return (
			<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entity-inline.strong--3">
				{i18n._(UNKNOWN_ENTITY_DESCRIPTOR)}
			</strong>
		);
	return <strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entity-inline.strong--4">{label}</strong>;
};
/**
 * A value that is already a name rather than an id: a channel's name, a nickname, a
 * vanity code. It is printed as written, because looking it up would resolve a name
 * that happens to be all digits to whatever entity owns that id — a channel named
 * after someone's user id read as that user's name.
 */
const renderNameInline = (name: string, i18n: I18n): React.ReactNode => {
	if (!name.trim())
		return (
			<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-name-inline.strong">
				{i18n._(SOMETHING_DESCRIPTOR)}
			</strong>
		);
	return <strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-name-inline.strong--2">{name}</strong>;
};
/** Renders whichever of the two an entry's target turned out to be. */
const renderTargetInline = (target: AuditLogTarget, guildId: string | undefined, i18n: I18n): React.ReactNode =>
	target.kind === 'id' ? renderEntityInline(target.value, guildId, i18n) : renderNameInline(target.value, i18n);
const renderActorInline = (
	actorUser: User | null,
	actorId: string | null | undefined,
	guildId: string | undefined,
	i18n: I18n,
): React.ReactNode => {
	if (actorUser)
		return (
			<ClickableUser
				user={actorUser}
				guildId={guildId}
				showAvatar={false}
				data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-actor-inline.clickable-user"
			/>
		);
	if (actorId)
		return (
			<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-actor-inline.strong">
				{i18n._(SOMEONE_DESCRIPTOR)}
			</strong>
		);
	return (
		<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-actor-inline.strong--2">
			{i18n._(SOMEONE_DESCRIPTOR)}
		</strong>
	);
};
const renderMemberInline = (
	memberUser: User | null,
	fallback: AuditLogTarget | null,
	guildId: string | undefined,
	i18n: I18n,
): React.ReactNode => {
	if (memberUser)
		return (
			<ClickableUser
				user={memberUser}
				guildId={guildId}
				showAvatar={false}
				data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-member-inline.clickable-user"
			/>
		);
	if (fallback) return renderTargetInline(fallback, guildId, i18n);
	return (
		<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-member-inline.strong">
			{i18n._(SOMEONE_DESCRIPTOR)}
		</strong>
	);
};
const renderBoldValue = (content: React.ReactNode): React.ReactNode => (
	<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-bold-value.strong">{content}</strong>
);
export const renderValueInline = (value: unknown, guildId: string | undefined, i18n: I18n): React.ReactNode => {
	if (isEmptyString(value)) return renderBoldValue(i18n._(NOTHING_DESCRIPTOR));
	const scalar = safeScalarString(value, i18n);
	if (scalar !== null) {
		if (typeof value === 'number') return renderBoldValue(scalar);
		if (typeof value === 'boolean') return renderBoldValue(scalar);
		// A guild is passed only where the value is an id to resolve. Without one the
		// value is a plain field — a name, a code, a number — so it is printed as
		// written rather than guessed at from its shape, which would offer to copy the
		// "id" of a channel merely named after one.
		if (typeof value === 'string' && guildId && looksLikeSnowflake(value)) {
			const name = resolveIdToName(value, guildId);
			return (
				<CopyIdInline
					id={value}
					data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-value-inline.copy-id-inline"
				>
					<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-value-inline.strong">
						{name ?? value}
					</strong>
				</CopyIdInline>
			);
		}
		if (typeof value === 'string' && looksLikeHexColor(value))
			return (
				<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-value-inline.strong--3">{value}</strong>
			);
		return renderBoldValue(scalar);
	}
	if (Array.isArray(value)) {
		const count = value.length;
		return renderBoldValue(
			plural(
				{count},
				{
					one: '# item',
					other: '# items',
				},
			),
		);
	}
	if (isBasicRecord(value)) return renderBoldValue(i18n._(DETAILS_DESCRIPTOR));
	return renderBoldValue(i18n._(VALUE_DESCRIPTOR));
};
export const shouldShowFallbackChangeDetail = (change: ChangeShapeWithUnknowns): boolean => {
	return change.key.trim().length > 0 && (change.oldValue != null || change.newValue != null);
};
const formatChangeKeyLabel = (key: string): string => key.replace(/_/g, ' ').trim();
export const renderFallbackChangeDetail = (
	change: ChangeShapeWithUnknowns,
	guildId: string | undefined,
	i18n: I18n,
): React.ReactNode => {
	const fieldLabel = formatChangeKeyLabel(change.key);
	const fieldNode = renderValueInline(fieldLabel, guildId, i18n);
	if (change.oldValue != null && change.newValue != null) {
		return (
			<Trans>
				Updated {fieldNode} from {renderValueInline(change.oldValue, guildId, i18n)} to{' '}
				{renderValueInline(change.newValue, guildId, i18n)}.
			</Trans>
		);
	}
	if (change.newValue != null) {
		return (
			<Trans>
				Set {fieldNode} to {renderValueInline(change.newValue, guildId, i18n)}.
			</Trans>
		);
	}
	if (change.oldValue != null) {
		return (
			<Trans>
				Cleared {fieldNode} (was {renderValueInline(change.oldValue, guildId, i18n)}).
			</Trans>
		);
	}
	return <Trans>Updated {fieldNode}.</Trans>;
};
export const renderOptionDetailSentence = (
	key: string,
	value: unknown,
	guildId: string | undefined,
	_actionType: AuditLogActionType | undefined,
	i18n: I18n,
): React.ReactNode => {
	if (key === 'type') {
		const label = getChannelTypeLabel(value, i18n);
		if (label) {
			return <Trans>Channel type: {renderValueInline(label, guildId, i18n)}.</Trans>;
		}
		return <Trans>Channel type: {renderValueInline(value, guildId, i18n)}.</Trans>;
	}
	if (key === 'channel_id') {
		return <Trans>Channel: {renderValueInline(value, guildId, i18n)}.</Trans>;
	}
	if (key === 'message_id') {
		return <Trans>Message: {renderValueInline(value, guildId, i18n)}.</Trans>;
	}
	if (key === 'inviter_id') {
		return <Trans>Invited by {renderValueInline(value, guildId, i18n)}.</Trans>;
	}
	if (key === 'vanity_url_code') {
		return <Trans>Vanity URL code: {renderValueInline(value, undefined, i18n)}.</Trans>;
	}
	if (key === 'uses') {
		const count = typeof value === 'number' ? value : Number(value);
		return (
			<Plural
				value={count}
				one="Used # time."
				other="Used # times."
				data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural"
			/>
		);
	}
	if (key === 'created_at') {
		const formatted = formatDateStringValue(value);
		if (formatted) {
			return <Trans>Created on {renderValueInline(formatted, guildId, i18n)}.</Trans>;
		}
	}
	if (key === 'temporary') {
		return value === true ? (
			<Trans>
				<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.strong">
					Grants
				</strong>{' '}
				temporary membership.
			</Trans>
		) : (
			<Trans>
				<strong data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.strong--2">
					Grants
				</strong>{' '}
				permanent membership.
			</Trans>
		);
	}
	if (key === 'name') {
		return <Trans>Name: {renderValueInline(value, undefined, i18n)}.</Trans>;
	}
	if (key === 'count' || key === 'delete_count' || key === 'messages' || key === 'message_count') {
		const count = typeof value === 'number' ? value : Number(value);
		return (
			<Plural
				value={count}
				one="Deleted # message."
				other="Deleted # messages."
				data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--2"
			/>
		);
	}
	if (key === 'members_removed' || key === 'members_pruned') {
		const count = typeof value === 'number' ? value : Number(value);
		return (
			<Plural
				value={count}
				one="Removed # member."
				other="Removed # members."
				data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--3"
			/>
		);
	}
	if (key === 'channel') {
		return <Trans>Channel: {renderValueInline(value, guildId, i18n)}.</Trans>;
	}
	if (key === 'max_age') {
		const seconds = typeof value === 'number' ? value : null;
		if (seconds === 0) {
			return <Trans>This invite never expires.</Trans>;
		}
		if (seconds != null) {
			const minutes = seconds / 60;
			const hours = minutes / 60;
			const days = hours / 24;
			if (days >= 1 && days % 1 === 0) {
				return (
					<Plural
						value={days}
						one="This invite expires in # day."
						other="This invite expires in # days."
						data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--4"
					/>
				);
			}
			if (hours >= 1 && hours % 1 === 0) {
				return (
					<Plural
						value={hours}
						one="This invite expires in # hour."
						other="This invite expires in # hours."
						data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--5"
					/>
				);
			}
			if (minutes >= 1 && minutes % 1 === 0) {
				return (
					<Plural
						value={minutes}
						one="This invite expires in # minute."
						other="This invite expires in # minutes."
						data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--6"
					/>
				);
			}
			return (
				<Plural
					value={seconds}
					one="This invite expires in # second."
					other="This invite expires in # seconds."
					data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--7"
				/>
			);
		}
	}
	if (key === 'delete_member_days') {
		const days = typeof value === 'number' ? value : null;
		if (days != null) {
			return (
				<Plural
					value={days}
					one="Members inactive for # day will be pruned."
					other="Members inactive for # days will be pruned."
					data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-option-detail-sentence.plural--8"
				/>
			);
		}
	}
	if (key === 'role_name') {
		return <Trans>Role: {renderValueInline(value, guildId, i18n)}.</Trans>;
	}
	const fallbackLabel = formatChangeKeyLabel(key);
	return (
		<Trans>
			Value for {renderValueInline(fallbackLabel, guildId, i18n)}: {renderValueInline(value, guildId, i18n)}.
		</Trans>
	);
};
export const findChangeNewNumber = (changes: Array<AuditLogChange> | null | undefined, key: string): number | null => {
	if (!changes) return null;
	for (const raw of changes) {
		const c = toChangeShape(raw);
		if (c.key === key && typeof c.newValue === 'number') return c.newValue;
	}
	return null;
};
export const findChangeNewScalar = (
	changes: Array<AuditLogChange> | null | undefined,
	key: string,
	i18n: I18n,
): string | null => {
	if (!changes) return null;
	for (const raw of changes) {
		const c = toChangeShape(raw);
		if (c.key !== key) continue;
		const s = safeScalarString(c.newValue, i18n);
		if (s != null) return s;
	}
	return null;
};
export const findChangeScalar = (
	changes: Array<AuditLogChange> | null | undefined,
	key: string,
	i18n: I18n,
): string | null => {
	if (!changes) return null;
	for (const raw of changes) {
		const c = toChangeShape(raw);
		if (c.key !== key) continue;
		const newScalar = safeScalarString(c.newValue, i18n);
		if (newScalar != null) return newScalar;
		const oldScalar = safeScalarString(c.oldValue, i18n);
		if (oldScalar != null) return oldScalar;
	}
	return null;
};
const getOptionScalar = (entry: GuildAuditLogEntryResponse, keys: Array<string>, i18n: I18n): string | null => {
	const options: unknown = entry.options;
	if (!isBasicRecord(options)) return null;
	for (const k of keys) {
		const v: unknown = options[k];
		const s = safeScalarString(v, i18n);
		if (s != null) return s;
	}
	return null;
};
const getOptionNumber = (entry: GuildAuditLogEntryResponse, keys: Array<string>, i18n: I18n): number | null => {
	const options: unknown = entry.options;
	if (!isBasicRecord(options)) return null;
	for (const k of keys) {
		const v: unknown = options[k];
		if (typeof v === 'number') return v;
		const s = safeScalarString(v, i18n);
		if (s != null) {
			const n = Number(s);
			if (!Number.isNaN(n)) return n;
		}
	}
	return null;
};
/**
 * What an entry is about: either the id of its target, or a name read out of its
 * options when no target id was recorded. Which one it is has to travel with the
 * value, since only an id may be looked up — resolving a name would turn one that
 * happens to be all digits into whatever entity owns that id.
 */
export type AuditLogTarget = {kind: 'id'; value: string} | {kind: 'name'; value: string};

/** Options that can stand in for a missing target id, in order of preference. */
const TARGET_OPTION_KEYS: ReadonlyArray<readonly [string, AuditLogTarget['kind']]> = [
	['name', 'name'],
	['title', 'name'],
	['code', 'name'],
	['channel', 'id'],
	['channel_id', 'id'],
	['id', 'id'],
	['target_id', 'id'],
];

export const resolveTargetLabel = (entry: GuildAuditLogEntryResponse, i18n: I18n): AuditLogTarget => {
	if (entry.target_id) return {kind: 'id', value: entry.target_id};
	const options: unknown = entry.options;
	if (isBasicRecord(options)) {
		for (const [key, kind] of TARGET_OPTION_KEYS) {
			const scalar = safeScalarString(options[key], i18n);
			if (scalar) return {kind, value: scalar};
		}
	}
	return {kind: 'name', value: i18n._(UNKNOWN_TARGET_DESCRIPTOR)};
};
export const resolveChannelLabel = (
	entry: GuildAuditLogEntryResponse,
	guildId: string | undefined,
	i18n: I18n,
): string | null => {
	const options: unknown = entry.options;
	if (!isBasicRecord(options)) return null;
	const channelValue: unknown = options.channel ?? options.channel_id;
	const channelId = safeScalarString(channelValue, i18n);
	if (!channelId) return null;
	if (guildId && looksLikeSnowflake(channelId)) {
		const channel = Channels.getChannel(channelId);
		if (channel?.name) return channel.name;
	}
	return looksLikeSnowflake(channelId) ? null : channelId;
};
const resolveChannelRecord = (entry: GuildAuditLogEntryResponse, i18n: I18n) => {
	const options: unknown = entry.options;
	if (!isBasicRecord(options)) return null;
	const channelValue: unknown = options.channel ?? options.channel_id;
	const channelId = safeScalarString(channelValue, i18n);
	if (!channelId) return null;
	return Channels.getChannel(channelId) ?? null;
};
export const formatTimestamp = (logId: string): string => {
	const timestamp = SnowflakeUtils.extractTimestamp(logId);
	return getFormattedDateTime(timestamp);
};

export interface AuditLogUserOption extends ComboboxOption<string> {
	user: User;
}

export const buildUserOptions = (members: Array<{user: User}> | undefined): Array<AuditLogUserOption> => {
	if (!members) return [];
	return members
		.slice()
		.sort((a, b) => NicknameUtils.getDisplayName(a.user).localeCompare(NicknameUtils.getDisplayName(b.user)))
		.map((member) => {
			const label = NicknameUtils.getDisplayName(member.user);
			return {value: member.user.id, label, user: member.user};
		});
};
export const renderEntrySummary = (args: {
	entry: GuildAuditLogEntryResponse;
	actorUser: User | null;
	targetUser: User | null;
	target: AuditLogTarget;
	channelLabel: string | null;
	guildId: string;
	i18n: I18n;
}): React.ReactNode => {
	const {entry, actorUser, targetUser, target, channelLabel, guildId, i18n} = args;
	const actor = renderActorInline(actorUser, entry.user_id, guildId, i18n);
	const targetMember = renderMemberInline(
		targetUser,
		entry.target_id ? {kind: 'id', value: entry.target_id} : target,
		guildId,
		i18n,
	);
	const targetEntity = renderTargetInline(target, guildId, i18n);
	const channelRecord = resolveChannelRecord(entry, i18n);
	const channelDisplayLabel = channelRecord
		? `${channelRecord.type === ChannelTypes.GUILD_TEXT ? '#' : ''}${channelRecord.name ?? i18n._(UNKNOWN_CHANNEL_DESCRIPTOR)}`
		: (channelLabel ?? null);
	const channelNode = channelDisplayLabel ? (
		<span
			className={styles.channelPlain}
			data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entry-summary.channel-plain"
		>
			{channelDisplayLabel}
		</span>
	) : null;
	const actionType = entry.action_type as AuditLogActionType;
	const changedName =
		findChangeScalar(entry.changes, 'name', i18n) ??
		findChangeScalar(entry.changes, 'nick', i18n) ??
		findChangeScalar(entry.changes, 'code', i18n) ??
		getOptionScalar(entry, ['name', 'title', 'code'], i18n) ??
		null;
	// `changedName` is the name the entry recorded, never an id, so it is printed as
	// written. Resolving it turned a channel named after a user's id into that user.
	const namedTarget = changedName ? renderNameInline(changedName, i18n) : targetEntity;
	const pruneDaysRaw = findChangeNewScalar(entry.changes, 'prune_delete_days', i18n);
	const pruneDays = pruneDaysRaw ? Number(pruneDaysRaw) : null;
	const bulkCount = getOptionNumber(entry, ['count', 'delete_count', 'messages', 'message_count'], i18n);
	const withBecause = (sentence: React.ReactNode) => sentence;
	switch (actionType) {
		case AuditLogActionType.GUILD_UPDATE:
			return withBecause(<Trans>{actor} updated the community settings.</Trans>);
		case AuditLogActionType.CHANNEL_CREATE:
			return withBecause(
				<Trans>
					{actor} created the channel {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.CHANNEL_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the channel {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.CHANNEL_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the channel {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.THREAD_CREATE:
			return withBecause(
				<Trans>
					{actor} created the thread {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.THREAD_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the thread {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.THREAD_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the thread {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.CHANNEL_OVERWRITE_CREATE:
			return channelNode
				? withBecause(
						<Trans>
							{actor} added channel permissions for {targetEntity} in {channelNode}.
						</Trans>,
					)
				: withBecause(
						<Trans>
							{actor} added channel permissions for {targetEntity}.
						</Trans>,
					);
		case AuditLogActionType.CHANNEL_OVERWRITE_UPDATE:
			return channelNode
				? withBecause(
						<Trans>
							{actor} updated channel permissions for {targetEntity} in {channelNode}.
						</Trans>,
					)
				: withBecause(
						<Trans>
							{actor} updated channel permissions for {targetEntity}.
						</Trans>,
					);
		case AuditLogActionType.CHANNEL_OVERWRITE_DELETE:
			return channelNode
				? withBecause(
						<Trans>
							{actor} removed channel permissions for {targetEntity} in {channelNode}.
						</Trans>,
					)
				: withBecause(
						<Trans>
							{actor} removed channel permissions for {targetEntity}.
						</Trans>,
					);
		case AuditLogActionType.MEMBER_KICK:
			return withBecause(
				<Trans>
					{actor} kicked {targetMember}.
				</Trans>,
			);
		case AuditLogActionType.MEMBER_BAN_ADD:
			return withBecause(
				<Trans>
					{actor} banned {targetMember}.
				</Trans>,
			);
		case AuditLogActionType.MEMBER_BAN_REMOVE:
			return withBecause(
				<Trans>
					{actor} unbanned {targetMember}.
				</Trans>,
			);
		case AuditLogActionType.MEMBER_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated {targetMember}.
				</Trans>,
			);
		case AuditLogActionType.MEMBER_ROLE_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated roles for {targetMember}.
				</Trans>,
			);
		case AuditLogActionType.MEMBER_PRUNE:
			return withBecause(
				pruneDays != null && !Number.isNaN(pruneDays) ? (
					<Trans>
						{actor} pruned members inactive for{' '}
						<Plural
							value={pruneDays}
							one="# day"
							other="# days"
							data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entry-summary.plural"
						/>
						.
					</Trans>
				) : (
					<Trans>{actor} pruned inactive members.</Trans>
				),
			);
		case AuditLogActionType.MEMBER_MOVE:
			return withBecause(
				channelNode ? (
					<Trans>
						{actor} moved {targetMember} to {channelNode}.
					</Trans>
				) : (
					<Trans>
						{actor} moved {targetMember} to another voice channel.
					</Trans>
				),
			);
		case AuditLogActionType.MEMBER_DISCONNECT:
			return withBecause(
				<Trans>
					{actor} disconnected {targetMember} from voice.
				</Trans>,
			);
		case AuditLogActionType.BOT_ADD:
			return withBecause(
				<Trans>
					{actor} added the bot {targetMember}.
				</Trans>,
			);
		case AuditLogActionType.ROLE_CREATE:
			return withBecause(
				<Trans>
					{actor} created the role {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.ROLE_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the role {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.ROLE_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the role {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.INVITE_CREATE:
			return withBecause(
				<Trans>
					{actor} created the invite {namedTarget}
					{channelNode ? <> for {channelNode}</> : null}.
				</Trans>,
			);
		case AuditLogActionType.INVITE_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the invite {namedTarget}
					{channelNode ? <> for {channelNode}</> : null}.
				</Trans>,
			);
		case AuditLogActionType.INVITE_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the invite {namedTarget}
					{channelNode ? <> for {channelNode}</> : null}.
				</Trans>,
			);
		case AuditLogActionType.WEBHOOK_CREATE:
			return withBecause(
				<Trans>
					{actor} created the webhook {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.WEBHOOK_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the webhook {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.WEBHOOK_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the webhook {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.EMOJI_CREATE:
			return withBecause(
				<Trans>
					{actor} added the emoji {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.EMOJI_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the emoji {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.EMOJI_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the emoji {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.STICKER_CREATE:
			return withBecause(
				<Trans>
					{actor} added the sticker {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.STICKER_UPDATE:
			return withBecause(
				<Trans>
					{actor} updated the sticker {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.STICKER_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted the sticker {namedTarget}.
				</Trans>,
			);
		case AuditLogActionType.MESSAGE_DELETE:
			return withBecause(
				<Trans>
					{actor} deleted a message{channelNode ? <> in {channelNode}</> : null}.
				</Trans>,
			);
		case AuditLogActionType.MESSAGE_BULK_DELETE:
			return withBecause(
				bulkCount != null ? (
					<Trans>
						{actor} deleted {renderValueInline(bulkCount, guildId, i18n)}{' '}
						<Plural
							value={bulkCount}
							one="message"
							other="messages"
							data-flx="guild.guild-tabs.guild-audit-log-tab-utils.render-entry-summary.plural--2"
						/>
						{channelNode ? <> in {channelNode}</> : null}.
					</Trans>
				) : (
					<Trans>
						{actor} deleted multiple messages{channelNode ? <> in {channelNode}</> : null}.
					</Trans>
				),
			);
		case AuditLogActionType.MESSAGE_PIN:
			return withBecause(
				<Trans>
					{actor} pinned a message{channelNode ? <> in {channelNode}</> : null}.
				</Trans>,
			);
		case AuditLogActionType.MESSAGE_UNPIN:
			return withBecause(
				<Trans>
					{actor} unpinned a message{channelNode ? <> in {channelNode}</> : null}.
				</Trans>,
			);
		default:
			return withBecause(
				<Trans>
					{actor} performed an audit action on {targetEntity}.
				</Trans>,
			);
	}
};
