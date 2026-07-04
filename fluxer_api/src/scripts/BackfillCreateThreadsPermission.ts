// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One-off backfill: grant CREATE_THREADS to every existing guild role that
 * already holds MANAGE_GUILD or MANAGE_CHANNELS.
 *
 * This mirrors the rollout rule for the threads feature: in pre-existing
 * communities the ability to start threads is turned on for any role with
 * "manage community" or "manage channel" permissions. New communities get
 * CREATE_THREADS on @everyone automatically via DEFAULT_PERMISSIONS, so they
 * are intentionally NOT touched here.
 *
 * Intended to be run once, during a deploy/restart window, so gateway guild
 * processes reload fresh role state afterwards. It does a full paged scan of
 * `guild_roles` and only writes rows that actually need changing (idempotent:
 * re-running is a no-op once every eligible role already has the bit).
 *
 * Usage:
 *   pnpm --filter fluxer_api backfill:create-threads            # apply
 *   pnpm --filter fluxer_api backfill:create-threads -- --dry-run  # preview only
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

const MANAGE_MASK = Permissions.MANAGE_GUILD | Permissions.MANAGE_CHANNELS;
const PAGE_SIZE = 500;

type ScannedRole = Pick<GuildRoleRow, 'guild_id' | 'role_id' | 'permissions' | 'version'>;

function needsBackfill(permissions: bigint): boolean {
	const hasManage = (permissions & MANAGE_MASK) !== 0n;
	const alreadyHasCreateThreads = (permissions & Permissions.CREATE_THREADS) !== 0n;
	return hasManage && !alreadyHasCreateThreads;
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
				const newPermissions = permissions | Permissions.CREATE_THREADS;
				updated += 1;
				if (dryRun) {
					Logger.info(
						{guildId: role.guild_id.toString(), roleId: role.role_id.toString()},
						'[dry-run] would grant CREATE_THREADS',
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
			dryRun ? 'CREATE_THREADS backfill dry-run complete' : 'CREATE_THREADS backfill complete',
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
		Logger.error({error}, 'CREATE_THREADS backfill failed');
		process.exit(1);
	},
);
