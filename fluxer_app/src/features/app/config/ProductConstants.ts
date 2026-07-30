// SPDX-License-Identifier: AGPL-3.0-or-later

function getBootstrapProductName(): string {
	if (typeof window === 'undefined') {
		return 'Fluxer';
	}
	const productName = window.__FLUXER_BOOTSTRAP__?.instance.app_public?.branding?.product_name?.trim();
	return productName || 'Fluxer';
}

export const PRODUCT_NAME = getBootstrapProductName();
export const PREMIUM_PRODUCT_NAME = 'Plutonium';
/**
 * The system account that carries instance-staff announcements. Deliberately not
 * derived from the product name: it is its own identity, so it reads the same on
 * every instance regardless of branding.
 */
export const MEGAPHONE_NAME = 'Megaphone';
export const PREMIUM_PRODUCT_FULL_NAME = `${PRODUCT_NAME} ${PREMIUM_PRODUCT_NAME}`;
