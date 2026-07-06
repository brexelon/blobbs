// SPDX-License-Identifier: AGPL-3.0-or-later

import type {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import type {INatsConnectionManager} from '@pkgs/nats/src/INatsConnectionManager';
import {type NatsConnection, StringCodec} from 'nats';
import {describe, expect, it} from 'vitest';
import {createUserID, type UserID} from '../BrandedTypes';
import {FallbackUsersServiceClient, NatsUsersServiceClient, type IUsersServiceClient} from './UsersServiceClient';

interface FakeRequest {
	subject: string;
	body: Record<string, unknown>;
	timeout: number | undefined;
}

class FakeNatsConnectionManager implements INatsConnectionManager {
	private readonly codec = StringCodec();
	private closed = true;
	private readonly responses: Array<unknown>;
	readonly requests: Array<FakeRequest> = [];
	connectCalls = 0;
	drained = false;

	constructor(responses: Array<unknown>) {
		this.responses = [...responses];
	}

	async connect(): Promise<void> {
		this.connectCalls += 1;
		this.closed = false;
	}

	getConnection(): NatsConnection {
		if (this.closed) {
			throw new Error('not connected');
		}
		return {
			request: async (subject: string, data: Uint8Array, options?: {timeout?: number}) => {
				this.requests.push({
					subject,
					body: JSON.parse(this.codec.decode(data)) as Record<string, unknown>,
					timeout: options?.timeout,
				});
				const response = this.responses.shift();
				if (response instanceof Error) {
					throw response;
				}
				return {
					data: this.codec.encode(JSON.stringify(response)),
				};
			},
		} as unknown as NatsConnection;
	}

	async drain(): Promise<void> {
		this.drained = true;
		this.closed = true;
	}

	isClosed(): boolean {
		return this.closed;
	}
}

describe('NatsUsersServiceClient', () => {
	it('requests API user partials with string snowflakes and maps the response by id', async () => {
		const userId = createUserID(9223372036854775807n);
		const partial: UserPartialResponse = {
			id: userId.toString(),
			username: 'Ada',
			discriminator: '0',
			global_name: 'Ada Lovelace',
			avatar: 'avatar_hash',
			avatar_color: 0x336699,
			flags: 1,
		};
		const manager = new FakeNatsConnectionManager([{FoundApiPartials: [partial]}]);
		const client = new NatsUsersServiceClient(manager, 321, 'svc.users.test');

		const result = await client.getUserPartialResponses([userId]);

		expect(manager.connectCalls).toBe(1);
		expect(manager.requests).toEqual([
			{
				subject: 'svc.users.test',
				body: {
					op: 'GetApiPartialsByIds',
					user_ids: ['9223372036854775807'],
				},
				timeout: 321,
			},
		]);
		expect(result.get(userId)).toEqual(partial);
	});

	it('sends invalidation requests with a string user id', async () => {
		const userId = createUserID(9007199254740993n);
		const manager = new FakeNatsConnectionManager(['Invalidated']);
		const client = new NatsUsersServiceClient(manager, 250, 'svc.users.test');

		await client.invalidateUserCache(userId);

		expect(manager.requests).toEqual([
			{
				subject: 'svc.users.test',
				body: {
					op: 'Invalidate',
					user_id: '9007199254740993',
				},
				timeout: 250,
			},
		]);
	});

	it('coalesces concurrent overlapping partial lookups without retaining a completed cache entry', async () => {
		const userId = createUserID(9223372036854775807n);
		const secondUserId = createUserID(9223372036854775806n);
		const partial: UserPartialResponse = {
			id: userId.toString(),
			username: 'Cached',
			discriminator: '0',
			global_name: null,
			avatar: null,
			avatar_color: null,
			flags: 0,
		};
		const secondPartial: UserPartialResponse = {
			...partial,
			id: secondUserId.toString(),
			username: 'Second',
		};
		const manager = new FakeNatsConnectionManager([
			{FoundApiPartials: [secondPartial, partial]},
			{FoundApiPartials: [partial]},
		]);
		const client = new NatsUsersServiceClient(manager, 250, 'svc.users.test', 100);

		const [first, second] = await Promise.all([
			client.getUserPartialResponses([secondUserId, userId, userId]),
			client.getUserPartialResponses([userId]),
		]);
		await client.getUserPartialResponses([userId]);

		expect(manager.requests).toHaveLength(2);
		expect(first.get(userId)).toEqual(partial);
		expect(first.get(secondUserId)).toEqual(secondPartial);
		expect(second.get(userId)).toEqual(partial);
	});

	it('falls back to the repository client when the NATS users service fails', async () => {
		const userId = createUserID(5001n);
		const partial: UserPartialResponse = {
			id: userId.toString(),
			username: 'FallbackUser',
			discriminator: '0',
			global_name: null,
			avatar: null,
			avatar_color: null,
			flags: 0,
		};
		const manager = new FakeNatsConnectionManager([{error: 'shard_unavailable'}]);
		const natsClient = new NatsUsersServiceClient(manager, 250, 'svc.users.test');
		const repositoryClient: IUsersServiceClient = {
			getUserPartialResponses: async (userIds) => {
				const result = new Map<UserID, UserPartialResponse>();
				for (const id of userIds) {
					if (id === userId) {
						result.set(id, partial);
					}
				}
				return result;
			},
			invalidateUserCache: async () => {},
		};
		const client = new FallbackUsersServiceClient(natsClient, repositoryClient);

		const result = await client.getUserPartialResponses([userId]);

		expect(manager.requests).toHaveLength(1);
		expect(result.get(userId)).toEqual(partial);
	});

	it('backfills repository misses after a successful NATS users service response', async () => {
		const serviceUserId = createUserID(7001n);
		const repositoryUserId = createUserID(7002n);
		const servicePartial: UserPartialResponse = {
			id: serviceUserId.toString(),
			username: 'FromService',
			discriminator: '0',
			global_name: null,
			avatar: null,
			avatar_color: null,
			flags: 0,
		};
		const repositoryPartial: UserPartialResponse = {
			id: repositoryUserId.toString(),
			username: 'FromRepository',
			discriminator: '0',
			global_name: null,
			avatar: null,
			avatar_color: null,
			flags: 0,
		};
		const manager = new FakeNatsConnectionManager([{FoundApiPartials: [servicePartial]}]);
		const natsClient = new NatsUsersServiceClient(manager, 250, 'svc.users.test');
		const repositoryClient: IUsersServiceClient = {
			getUserPartialResponses: async (userIds) => {
				const result = new Map<UserID, UserPartialResponse>();
				for (const id of userIds) {
					if (id === repositoryUserId) {
						result.set(id, repositoryPartial);
					}
				}
				return result;
			},
			invalidateUserCache: async () => {},
		};
		const client = new FallbackUsersServiceClient(natsClient, repositoryClient);

		const result = await client.getUserPartialResponses([serviceUserId, repositoryUserId]);

		expect(manager.requests).toHaveLength(1);
		expect(result.get(serviceUserId)).toEqual(servicePartial);
		expect(result.get(repositoryUserId)).toEqual(repositoryPartial);
	});

	it('enriches null avatars from the repository after a successful NATS users service response', async () => {
		const userId = createUserID(7003n);
		const servicePartial: UserPartialResponse = {
			id: userId.toString(),
			username: 'FromService',
			discriminator: '0',
			global_name: 'Ada',
			avatar: null,
			avatar_color: null,
			flags: 0,
		};
		const repositoryPartial: UserPartialResponse = {
			id: userId.toString(),
			username: 'FromService',
			discriminator: '0',
			global_name: 'Ada',
			avatar: 'avatar_hash',
			avatar_color: 0x336699,
			flags: 0,
		};
		const manager = new FakeNatsConnectionManager([{FoundApiPartials: [servicePartial]}]);
		const natsClient = new NatsUsersServiceClient(manager, 250, 'svc.users.test');
		const repositoryClient: IUsersServiceClient = {
			getUserPartialResponses: async (userIds) => {
				const result = new Map<UserID, UserPartialResponse>();
				for (const id of userIds) {
					if (id === userId) {
						result.set(id, repositoryPartial);
					}
				}
				return result;
			},
			invalidateUserCache: async () => {},
		};
		const client = new FallbackUsersServiceClient(natsClient, repositoryClient);

		const result = await client.getUserPartialResponses([userId]);

		expect(manager.requests).toHaveLength(1);
		expect(result.get(userId)).toEqual(repositoryPartial);
	});

	it('falls back to the repository when the users service returns shard_handler_error', async () => {
		const userId = createUserID(6001n);
		const repositoryPartial: UserPartialResponse = {
			id: userId.toString(),
			username: 'FromRepository',
			discriminator: '0',
			global_name: null,
			avatar: 'avatar_hash',
			avatar_color: 0x336699,
			flags: 0,
		};
		const manager = new FakeNatsConnectionManager([{error: 'shard_handler_error'}]);
		const natsClient = new NatsUsersServiceClient(manager, 250, 'svc.users.test');
		const repositoryClient: IUsersServiceClient = {
			getUserPartialResponses: async (userIds) => {
				const result = new Map<UserID, UserPartialResponse>();
				for (const id of userIds) {
					if (id === userId) {
						result.set(id, repositoryPartial);
					}
				}
				return result;
			},
			invalidateUserCache: async () => {},
		};
		const client = new FallbackUsersServiceClient(natsClient, repositoryClient);

		const result = await client.getUserPartialResponses([userId]);

		expect(manager.requests).toHaveLength(1);
		expect(result.get(userId)).toEqual(repositoryPartial);
	});

	it('surfaces service error payloads from the users service without a fallback client', async () => {
		const userId = createUserID(6001n);
		const manager = new FakeNatsConnectionManager([{error: 'shard_handler_error'}]);
		const client = new NatsUsersServiceClient(manager, 250, 'svc.users.test');

		await expect(client.getUserPartialResponses([userId])).rejects.toThrow('[users-service] shard_handler_error');
	});
});
