// SPDX-License-Identifier: AGPL-3.0-or-later

import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {BadRequestError} from '@fluxer/errors/src/domains/core/BadRequestError';
import type {IUserAccountRepository} from '../user/repositories/IUserAccountRepository';

interface GenerateDiscriminatorParams {
	username: string;
	requestedDiscriminator?: number;
	user?: unknown;
}

interface GenerateDiscriminatorResult {
	discriminator: number;
	available: boolean;
}

interface ResolveUsernameChangeParams {
	currentUsername: string;
	currentDiscriminator?: number;
	newUsername: string;
	user?: unknown;
	requestedDiscriminator?: number;
}

interface ResolveUsernameChangeResult {
	username: string;
	discriminator: number;
}

export class UsernameNotAvailableError extends BadRequestError {
	constructor() {
		super({code: APIErrorCodes.USERNAME_NOT_AVAILABLE});
		this.name = 'UsernameNotAvailableError';
	}
}

export interface IDiscriminatorService {
	generateDiscriminator(params: GenerateDiscriminatorParams): Promise<GenerateDiscriminatorResult>;
	isDiscriminatorAvailableForUsername(username: string, discriminator: number): Promise<boolean>;
	resolveUsernameChange(params: ResolveUsernameChangeParams): Promise<ResolveUsernameChangeResult>;
}

/** Simplified username availability checker — discriminators are no longer used. */
export class DiscriminatorService implements IDiscriminatorService {
	constructor(private readonly userRepository: IUserAccountRepository) {}

	async generateDiscriminator(params: GenerateDiscriminatorParams): Promise<GenerateDiscriminatorResult> {
		const available = await this.userRepository.isUsernameAvailable(params.username.toLowerCase());
		return {discriminator: 0, available};
	}

	async isDiscriminatorAvailableForUsername(username: string, _discriminator: number): Promise<boolean> {
		return this.userRepository.isUsernameAvailable(username.toLowerCase());
	}

	async resolveUsernameChange(params: ResolveUsernameChangeParams): Promise<ResolveUsernameChangeResult> {
		const {newUsername, currentUsername} = params;
		if (currentUsername.toLowerCase() === newUsername.toLowerCase()) {
			return {username: newUsername, discriminator: 0};
		}
		const available = await this.userRepository.isUsernameAvailable(newUsername.toLowerCase());
		if (!available) {
			throw new UsernameNotAvailableError();
		}
		return {username: newUsername, discriminator: 0};
	}
}
