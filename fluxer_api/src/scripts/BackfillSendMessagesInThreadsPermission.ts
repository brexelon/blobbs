// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One-off backfill: grant SEND_MESSAGES_IN_THREADS to every existing guild role
 * that already holds SEND_MESSAGES.
 *
 * Sending messages in threads is a newly split-out permission. Pre-existing
 * communities must keep behaving as before — anyone who could already talk in a
 * channel should still be able to talk in its threads — so we mirror the
 * SEND_MESSAGES bit onto SEND_MESSAGES_IN_THREADS for every role that has it.
 * New communities get SEND_MESSAGES_IN_THREADS on @everyone automatically via
 * DEFAULT_PERMISSIONS, so they are intentionally NOT touched here.
 *
 * Intended to be run once, during a deploy/restart window, so gateway guild
 * processes reload fresh role state afterwards. It does a full paged scan of
 * `guild_roles` and only writes rows that actually need changing (idempotent:
 * re-running is a no-op once every eligible role already has the bit).
 *
 * Usage:
 *   pnpm --filter fluxer_api backfill:send-messages-in-threads            # apply
 *   pnpm --filter fluxer_api backfill:send-messages-in-threads -- --dry-run  # preview only
 */

import {initializeConfig} from '@app/api/Config';
import {fetchPage, type PagedQueryResult, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {Db, nextVersion} from '@app/api/database/CassandraTypes';
import type {GuildRoleRow} from '@app/api/database/types/GuildTypes';
import {initializeLogger} from '@app/api/Logger';
import {GuildRoles} from '@app/api/Tables';
import {Config} from '@app/Config';
import {Logger} from '@app/Logger';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {initCassandra, shutdownCassandra} from '@pkgs/cassandra/src/Client';

const PAGE_SIZE = 500;

type ScannedRole = Pick<GuildRoleRow, 'guild_id' | 'role_id' | 'permissions' | 'version'>;

function needsBackfill(permissions: bigint): boolean {
	const hasSendMessages = (permissions & Permissions.SEND_MESSAGES) !== 0n;
	const alreadyHasSendInThreads = (permissions & Permissions.SEND_MESSAGES_IN_THREADS) !== 0n;
	return hasSendMessages && !alreadyHasSendInThreads;
}

async function run(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	initializeConfig(Config);
	initializeLogger(Logger);

	if (Config.database.backend !== 'cassandra') {
		throw new Error(`This backfill only supports the cassandra backend (got "${Config.database.backend}")`);
	}

	await initCassandra({
		hosts: Config.cassandra.hosts.split(',').filter(Boolean),
		port: Config.cassandra.port,
		keyspace: Config.cassandra.keyspace,
		localDc: Config.cassandra.localDc,
		username: Config.cassandra.username || undefined,
		password: Config.cassandra.password || undefined,
	});

	const selectCql = GuildRoles.selectCql({columns: ['guild_id', 'role_id', 'permissions', 'version']});

	let scanned = 0;
	let updated = 0;
	let pageState: string | null = null;

	try {
		do {
			const page: PagedQueryResult<ScannedRole> = await fetchPage<ScannedRole>(selectCql, undefined, {
				pageSize: PAGE_SIZE,
				pageState,
			});
			for (const role of page.rows) {
				scanned += 1;
				const permissions = BigInt(role.permissions ?? 0n);
				if (!needsBackfill(permissions)) {
					continue;
				}
				const newPermissions = permissions | Permissions.SEND_MESSAGES_IN_THREADS;
				updated += 1;
				if (dryRun) {
					Logger.info(
						{guildId: role.guild_id.toString(), roleId: role.role_id.toString()},
						'[dry-run] would grant SEND_MESSAGES_IN_THREADS',
					);
					continue;
				}
				await upsertOne(
					GuildRoles.patchByPk(
						{guild_id: role.guild_id, role_id: role.role_id},
						{permissions: Db.set(newPermissions), version: Db.set(nextVersion(role.version))},
					),
				);
			}
			pageState = page.pageState;
		} while (pageState != null);

		Logger.info(
			{scanned, updated, dryRun},
			dryRun ? 'SEND_MESSAGES_IN_THREADS backfill dry-run complete' : 'SEND_MESSAGES_IN_THREADS backfill complete',
		);
	} finally {
		await shutdownCassandra();
	}
}

run().then(
	() => {
		process.exit(0);
	},
	(error) => {
		Logger.error({error}, 'SEND_MESSAGES_IN_THREADS backfill failed');
		process.exit(1);
	},
);
