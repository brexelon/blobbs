// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import * as UserProfileCommands from '@app/features/user/commands/UserProfileCommands';
import type {ProfileTab} from '@app/features/user/components/modals/user_profile_modal/UserProfileModalShared';
import {makeAutoObservable} from 'mobx';

interface UserProfileMobileState {
	userId: string | null;
	guildId?: string;
	autoFocusNote?: boolean;
	initialTab?: ProfileTab;
}

class UserProfileMobile {
	private logger = new Logger('UserProfileMobile');
	userId: UserProfileMobileState['userId'] = null;
	guildId: UserProfileMobileState['guildId'] = undefined;
	autoFocusNote: UserProfileMobileState['autoFocusNote'] = undefined;
	initialTab: UserProfileMobileState['initialTab'] = undefined;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	get isOpen(): boolean {
		return this.userId !== null;
	}

	open(userId: string, guildId?: string, autoFocusNote?: boolean, initialTab?: ProfileTab): void {
		this.userId = userId;
		this.guildId = guildId;
		this.autoFocusNote = autoFocusNote;
		this.initialTab = initialTab;
		UserProfileCommands.fetch(userId, guildId).catch((error) => {
			this.logger.error('Failed to fetch user profile:', error);
		});
	}

	close(): void {
		this.userId = null;
		this.guildId = undefined;
		this.autoFocusNote = undefined;
		this.initialTab = undefined;
	}
}

export default new UserProfileMobile();
