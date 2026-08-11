// SPDX-License-Identifier: AGPL-3.0-or-later

import {ADMIN_OAUTH2_APPLICATION_ID} from '@fluxer/constants/src/Core';
import {describe, expect, test} from 'vitest';
import {createApplicationID} from '../../BrandedTypes';
import {Config} from '../../Config';
import {ApplicationRepository, buildAdminApplicationName} from '../repositories/ApplicationRepository';

const ADMIN_APPLICATION_ID = createApplicationID(ADMIN_OAUTH2_APPLICATION_ID);

describe('built-in admin application name', () => {
	test('follows the instance product name', () => {
		expect(buildAdminApplicationName('Blobbs')).toBe('Blobbs Admin');
	});

	test('trims surrounding whitespace', () => {
		expect(buildAdminApplicationName('  Blobbs  ')).toBe('Blobbs Admin');
	});

	test('falls back when the instance sets no name', () => {
		expect(buildAdminApplicationName('   ')).toBe('Fluxer Admin');
	});

	test('is used by the synthesised admin application', async () => {
		const repository = new ApplicationRepository(async () => 'Blobbs');
		const application = await repository.getApplication(ADMIN_APPLICATION_ID);
		expect(application?.name).toBe('Blobbs Admin');
	});

	test('falls back to the configured name when the instance config is unreachable', async () => {
		const repository = new ApplicationRepository(async () => {
			throw new Error('instance config unavailable');
		});
		const application = await repository.getApplication(ADMIN_APPLICATION_ID);
		expect(application?.name).toBe(`${Config.instance.branding.productName || 'Fluxer'} Admin`);
	});
});
