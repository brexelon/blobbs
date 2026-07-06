// SPDX-License-Identifier: AGPL-3.0-or-later

import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {SudoModeRequiredError} from '@fluxer/errors/src/domains/auth/SudoModeRequiredError';
import {ContentBlockedError} from '@fluxer/errors/src/domains/content/ContentBlockedError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import type {UserUpdateRequest} from '@fluxer/schema/src/domains/user/UserRequestSchemas';
import type {IRateLimitService} from '@pkgs/rate_limit/src/IRateLimitService';
import type {ApiContext} from '../../ApiContext';
import * as AuthPassword from '../../auth/AuthPassword';
import * as AuthSession from '../../auth/AuthSession';
import type {SudoVerificationResult} from '../../auth/services/SudoVerificationService';
import {deriveSudoMethods, userHasMfa} from '../../auth/services/SudoVerificationService';
import type {UserRow} from '../../database/types/UserTypes';
import type {AuthSession as AuthSessionModel} from '../../models/AuthSession';
import type {User} from '../../models/User';
import {enforceFluxerTagChangeRateLimit} from '../FluxerTagChangeRateLimit';
import type {IUserAccountRepository} from '../repositories/IUserAccountRepository';
import {isProfileSubstringExempt} from '../UserHelpers';
import {profileSubstringBlocklistCache} from '../../middleware/ProfileSubstringBlocklistCache';

interface UserUpdateMetadata {
	invalidateAuthSessions?: boolean;
}

type UserFieldUpdates = Partial<UserRow>;

interface UserAccountSecurityServiceDeps {
	apiContext: ApiContext;
	userAccountRepository: IUserAccountRepository;
	rateLimitService: IRateLimitService;
}

export class UserAccountSecurityService {
	constructor(private readonly deps: UserAccountSecurityServiceDeps) {}

	async processSecurityUpdates(params: {
		user: User;
		data: UserUpdateRequest;
		sudoContext?: SudoVerificationResult;
	}): Promise<{
		updates: UserFieldUpdates;
		metadata: UserUpdateMetadata;
	}> {
		const {user, data, sudoContext} = params;
		const updates: UserFieldUpdates = {
			password_hash: user.passwordHash,
			username: user.username,
			global_name: user.isBot ? null : user.globalName,
			email: user.email,
		};
		const metadata: UserUpdateMetadata = {
			invalidateAuthSessions: false,
		};
		const isUnclaimedAccount = user.isUnclaimedAccount();
		const identityVerifiedViaSudo = sudoContext?.method === 'mfa' || sudoContext?.method === 'sudo_token';
		const identityVerifiedViaPassword = sudoContext?.method === 'password';
		const hasMfa = userHasMfa(user);
		const rawEmail = data.email?.trim();
		const normalizedEmail = rawEmail?.toLowerCase();
		const hasPasswordRequiredChanges =
			(data.username !== undefined && data.username !== user.username) ||
			(data.email !== undefined && normalizedEmail !== user.email?.toLowerCase()) ||
			data.new_password !== undefined;
		const requiresVerification = hasPasswordRequiredChanges && !isUnclaimedAccount;
		if (requiresVerification && !identityVerifiedViaSudo && !identityVerifiedViaPassword) {
			throw new SudoModeRequiredError(hasMfa, deriveSudoMethods(user));
		}
		if (isUnclaimedAccount && data.new_password) {
			updates.password_hash = await this.hashNewPassword(data.new_password);
			updates.password_last_changed_at = new Date();
			metadata.invalidateAuthSessions = false;
		} else if (data.new_password) {
			if (!data.password) {
				throw InputValidationError.fromCode('password', ValidationErrorCodes.PASSWORD_NOT_SET);
			}
			if (!identityVerifiedViaSudo && !identityVerifiedViaPassword) {
				throw new SudoModeRequiredError(hasMfa, deriveSudoMethods(user));
			}
			updates.password_hash = await this.hashNewPassword(data.new_password);
			updates.password_last_changed_at = new Date();
			metadata.invalidateAuthSessions = true;
		}
		if (data.username !== undefined) {
			const newUsername = await this.updateUsername({user, username: data.username});
			if (
				!isProfileSubstringExempt(user) &&
				profileSubstringBlocklistCache.containsBannedSubstring('username', newUsername)
			) {
				throw new ContentBlockedError();
			}
			updates.username = newUsername;
		}
		await this.enforceUsernameChangeRateLimit({
			user,
			nextUsername: updates.username ?? user.username,
		});
		if (user.isBot) {
			updates.global_name = null;
		} else if (data.global_name !== undefined) {
			if (
				data.global_name &&
				!isProfileSubstringExempt(user) &&
				profileSubstringBlocklistCache.containsBannedSubstring('global_name', data.global_name)
			) {
				throw new ContentBlockedError();
			}
			updates.global_name = data.global_name;
		}
		if (rawEmail) {
			if (normalizedEmail && normalizedEmail !== user.email?.toLowerCase()) {
				const existing = await this.deps.userAccountRepository.findByEmail(normalizedEmail);
				if (existing && existing.id !== user.id) {
					throw InputValidationError.fromCode('email', ValidationErrorCodes.EMAIL_ALREADY_IN_USE);
				}
			}
			updates.email = rawEmail;
		}
		return {updates, metadata};
	}

	async invalidateAndRecreateSessions({
		user,
		oldAuthSession,
		request,
	}: {
		user: User;
		oldAuthSession: AuthSessionModel;
		request: Request;
	}): Promise<void> {
		await AuthSession.replaceCurrentAuthSession(this.deps.apiContext, {
			user,
			currentAuthSession: oldAuthSession,
			request,
		});
	}

	private async hashNewPassword(newPassword: string): Promise<string> {
		if (await AuthPassword.isPasswordPwned(this.deps.apiContext, newPassword)) {
			throw InputValidationError.fromCode('new_password', ValidationErrorCodes.PASSWORD_IS_TOO_COMMON);
		}
		return await AuthPassword.hashPassword(this.deps.apiContext, newPassword);
	}

	private async updateUsername({user, username}: {user: User; username: string}): Promise<string> {
		if (user.username.toLowerCase() === username.toLowerCase()) {
			return username;
		}
		const available = await this.deps.userAccountRepository.isUsernameAvailable(username.toLowerCase());
		if (!available) {
			throw InputValidationError.fromCode('username', ValidationErrorCodes.TOO_MANY_USERS_WITH_USERNAME_TRY_DIFFERENT);
		}
		return username;
	}

	private async enforceUsernameChangeRateLimit(params: {user: User; nextUsername: string}): Promise<void> {
		const {user, nextUsername} = params;
		if (nextUsername.toLowerCase() === user.username.toLowerCase()) {
			return;
		}
		await enforceFluxerTagChangeRateLimit({
			rateLimitService: this.deps.rateLimitService,
			userId: user.id,
		});
	}
}
