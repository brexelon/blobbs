// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One-off backfill: grant MANAGE_THREADS to every existing guild role that
 * already holds MANAGE_CHANNELS.
 *
 * Editing, closing, archiving, and deleting threads used to be gated on
 * MANAGE_CHANNELS; it is now its own MANAGE_THREADS permission. To keep
 * pre-existing communities behaving as before, every role that could already
 * manage channels (and therefore threads) keeps that ability by having
 * MANAGE_THREADS mirrored onto it. New communities are unaffected — thread
 * management stays an elevated permission granted explicitly, never to
 * @everyone by default.
 *
 * Intended to be run once, during a deploy/restart window, so gateway guild
 * processes reload fresh role state afterwards. It does a full paged scan of
 * `guild_roles` and only writes rows that actually need changing (idempotent:
 * re-running is a no-op once every eligible role already has the bit).
 *
 * Usage:
 *   pnpm --filter fluxer_api backfill:manage-threads            # apply
 *   pnpm --filter fluxer_api backfill:manage-threads -- --dry-run  # preview only
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
	const hasManageChannels = (permissions & Permissions.MANAGE_CHANNELS) !== 0n;
	const alreadyHasManageThreads = (permissions & Permissions.MANAGE_THREADS) !== 0n;
	return hasManageChannels && !alreadyHasManageThreads;
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
				const newPermissions = permissions | Permissions.MANAGE_THREADS;
				updated += 1;
				if (dryRun) {
					Logger.info(
						{guildId: role.guild_id.toString(), roleId: role.role_id.toString()},
						'[dry-run] would grant MANAGE_THREADS',
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
			dryRun ? 'MANAGE_THREADS backfill dry-run complete' : 'MANAGE_THREADS backfill complete',
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
		Logger.error({error}, 'MANAGE_THREADS backfill failed');
		process.exit(1);
	},
);
