// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formats the tag shown for an account.
 *
 * Regular users are unique by username and carry discriminator 0, so their tag is the
 * bare username. Applications are unique by (username, discriminator), so the
 * discriminator is the only thing telling two same-named bots apart.
 */
export function formatUserTag(username: string, discriminator: string | null | undefined): string {
	const parsed = Number.parseInt(discriminator ?? '', 10);
	if (!Number.isFinite(parsed) || parsed === 0) {
		return username;
	}
	return `${username}#${parsed.toString().padStart(4, '0')}`;
}
