// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Gif} from '@app/features/expressions/commands/GifCommands';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {downloadGifAsImageFile} from './GifFileDownload';

function media(url: string) {
	return {src: url, proxy_src: `/media/${encodeURIComponent(url)}`, width: 480, height: 270};
}

function gifWith(overrides: Partial<Gif>): Gif {
	return {
		id: 'an-item',
		slug: 'an-item',
		provider: 'klipy',
		title: 'An item',
		url: 'https://klipy.com/gifs/an-item',
		src: '',
		proxy_src: '',
		width: 480,
		height: 270,
		media: {},
		...overrides,
	};
}

/** Klipy leads with a clip and offers WebP, but no GIF rendition at all. */
function klipyGif(): Gif {
	return gifWith({
		src: 'https://cdn.klipy.test/hd.webm',
		proxy_src: '/media/hd.webm',
		media: {
			webm: media('https://cdn.klipy.test/hd.webm'),
			mp4: media('https://cdn.klipy.test/hd.mp4'),
			webp: media('https://cdn.klipy.test/hd.webp'),
			mediumwebp: media('https://cdn.klipy.test/md.webp'),
			tinywebp: media('https://cdn.klipy.test/sm.webp'),
		},
	});
}

/** Tenor leads with a GIF and names its renditions the way the old code assumed. */
function tenorGif(): Gif {
	return gifWith({
		provider: 'tenor',
		src: 'https://cdn.tenor.test/full.gif',
		proxy_src: '/media/full.gif',
		media: {
			gif: media('https://cdn.tenor.test/full.gif'),
			tinygif: media('https://cdn.tenor.test/tiny.gif'),
			mp4: media('https://cdn.tenor.test/full.mp4'),
		},
	});
}

function stubFetch(handler: (url: string) => {ok: boolean; size?: number}) {
	const seen: Array<string> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			seen.push(url);
			const {ok, size = 32} = handler(url);
			return {
				ok,
				blob: async () => new Blob([new Uint8Array(size)]),
			} as unknown as Response;
		}),
	);
	return seen;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('downloadGifAsImageFile', () => {
	it('falls back to WebP when the provider has no GIF rendition', async () => {
		stubFetch(() => ({ok: true}));
		const file = await downloadGifAsImageFile(klipyGif());
		expect(file.type).toBe('image/webp');
		expect(file.name).toBe('an-item.webp');
	});

	it('never downloads a clip as an image', async () => {
		const seen = stubFetch(() => ({ok: true}));
		await downloadGifAsImageFile(klipyGif());
		expect(seen.some((url) => /\.(?:webm|mp4)/u.test(url))).toBe(false);
	});

	it('still prefers a GIF rendition when the provider has one', async () => {
		stubFetch(() => ({ok: true}));
		const file = await downloadGifAsImageFile(tenorGif());
		expect(file.type).toBe('image/gif');
		expect(file.name).toBe('an-item.gif');
	});

	it('prefers the proxied source over the origin one', async () => {
		const seen = stubFetch(() => ({ok: true}));
		await downloadGifAsImageFile(tenorGif());
		expect(seen[0]).toBe('/media/https%3A%2F%2Fcdn.tenor.test%2Ffull.gif');
	});

	it('reaches the WebP renditions when every GIF candidate fails', async () => {
		const withBoth = gifWith({
			media: {
				gif: media('https://cdn.test/full.gif'),
				mediumgif: media('https://cdn.test/md.gif'),
				tinygif: media('https://cdn.test/sm.gif'),
				nanogif: media('https://cdn.test/xs.gif'),
				webp: media('https://cdn.test/full.webp'),
			},
		});
		stubFetch((url) => ({ok: url.includes('webp')}));
		const file = await downloadGifAsImageFile(withBoth);
		expect(file.type).toBe('image/webp');
	});

	it('skips empty responses', async () => {
		stubFetch((url) => ({ok: true, size: url.includes('hd.webp') ? 0 : 32}));
		const file = await downloadGifAsImageFile(klipyGif());
		expect(file.type).toBe('image/webp');
		expect(file.size).toBeGreaterThan(0);
	});

	it('throws when the item offers no image rendition at all', async () => {
		const clipOnly = gifWith({
			src: 'https://cdn.klipy.test/hd.webm',
			proxy_src: '/media/hd.webm',
			media: {webm: media('https://cdn.klipy.test/hd.webm'), mp4: media('https://cdn.klipy.test/hd.mp4')},
		});
		const seen = stubFetch(() => ({ok: true}));
		await expect(downloadGifAsImageFile(clipOnly)).rejects.toThrow('Failed to download GIF media');
		expect(seen).toEqual([]);
	});
});
