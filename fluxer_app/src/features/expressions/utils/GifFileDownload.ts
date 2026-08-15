// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Gif} from '@app/features/expressions/commands/GifCommands';

/**
 * Image renditions in preference order. GIF first because every provider that has one
 * offers it at every size; WebP because Klipy is video-first and many of its items carry
 * no GIF rendition at all, only `webm`, `mp4` and `webp`. Uploads accept both.
 */
const IMAGE_FORMAT_TOKENS = [
	{token: 'gif', contentType: 'image/gif', extension: 'gif'},
	{token: 'webp', contentType: 'image/webp', extension: 'webp'},
] as const;

/** Providers name a rendition by size: the bare token is the largest. */
const SIZE_PREFIXES = ['', 'medium', 'tiny', 'nano'] as const;

const GIF_VIDEO_FORMAT_KEYS = ['mp4', 'tinymp4'] as const;
/** Clip renditions, largest first, used only as transcode sources. */
const VIDEO_FORMAT_TOKENS = ['mp4', 'webm'] as const;
const TOP_LEVEL_IMAGE_URL_REGEX = /\.(?:gif|webp)(?:$|\?)/iu;
// Sized across more than one format family, so a missing GIF still leaves room to reach
// the WebP renditions behind it.
const DOWNLOAD_CANDIDATES_MAX = 12;

interface GifDownloadTarget {
	url: string;
	contentType: string;
	extension: string;
}

function sanitizeGifFileBaseName(gif: Gif): string {
	const base = (gif.id || gif.slug || 'gif').toLowerCase().replace(/[^a-z0-9_-]+/gu, '-');
	return base.length > 0 ? base.slice(0, 64) : 'gif';
}

function collectFormatTargets(
	gif: Gif,
	keys: ReadonlyArray<string>,
	contentType: string,
	extension: string,
): Array<GifDownloadTarget> {
	const targets: Array<GifDownloadTarget> = [];
	for (const key of keys) {
		const format = gif.media?.[key];
		if (!format) continue;
		if (format.proxy_src) {
			targets.push({url: format.proxy_src, contentType, extension});
		}
		if (format.src) {
			targets.push({url: format.src, contentType, extension});
		}
	}
	return targets;
}

function collectImageTargets(gif: Gif): Array<GifDownloadTarget> {
	const targets: Array<GifDownloadTarget> = [];
	for (const {token, contentType, extension} of IMAGE_FORMAT_TOKENS) {
		const keys = SIZE_PREFIXES.map((prefix) => `${prefix}${token}`);
		targets.push(...collectFormatTargets(gif, keys, contentType, extension));
	}
	// The top-level source is whichever rendition the provider leads with, which for a
	// video-first provider is a clip rather than an image.
	for (const url of [gif.proxy_src, gif.src]) {
		if (url && TOP_LEVEL_IMAGE_URL_REGEX.test(url)) {
			const extension = /\.webp(?:$|\?)/iu.test(url) ? 'webp' : 'gif';
			targets.push({url, contentType: `image/${extension}`, extension});
		}
	}
	return targets;
}

function collectVideoTargets(gif: Gif): Array<GifDownloadTarget> {
	return collectFormatTargets(gif, GIF_VIDEO_FORMAT_KEYS, 'video/mp4', 'mp4');
}

/**
 * The proxied URL a provider hands us is a signed media-proxy path, and the signature covers
 * that path alone, so a transform can be asked for with a query parameter. Only the proxied
 * URL is worth asking: a provider CDN would ignore the parameter and answer with the clip.
 */
function withImageTranscode(url: string): string {
	return `${url}${url.includes('?') ? '&' : '?'}format=webp`;
}

/**
 * Last resort for an item that carries no image rendition at all. The media proxy pulls a
 * single frame out of a clip, so this trades the animation for an image the uploader accepts
 * — worth it only once every animated rendition has been ruled out.
 */
function collectTranscodeTargets(gif: Gif): Array<GifDownloadTarget> {
	const targets: Array<GifDownloadTarget> = [];
	const addProxiedUrl = (url: string | undefined) => {
		if (!url) return;
		targets.push({url: withImageTranscode(url), contentType: 'image/webp', extension: 'webp'});
	};
	for (const token of VIDEO_FORMAT_TOKENS) {
		for (const prefix of SIZE_PREFIXES) {
			addProxiedUrl(gif.media?.[`${prefix}${token}`]?.proxy_src);
		}
	}
	// A video-first provider leads with a clip, which is a transcode source like any other.
	addProxiedUrl(gif.proxy_src);
	return targets;
}

async function downloadFirstAvailableTarget(targets: Array<GifDownloadTarget>, baseName: string): Promise<File> {
	const seenUrls = new Set<string>();
	let attempts = 0;
	for (const target of targets) {
		if (attempts >= DOWNLOAD_CANDIDATES_MAX) break;
		if (seenUrls.has(target.url)) continue;
		seenUrls.add(target.url);
		attempts += 1;
		try {
			const response = await fetch(target.url);
			if (!response.ok) continue;
			const blob = await response.blob();
			if (blob.size === 0) continue;
			return new File([blob], `${baseName}.${target.extension}`, {type: target.contentType});
		} catch {}
	}
	throw new Error('Failed to download GIF media');
}

/**
 * The transcode pass runs on its own budget so a provider that lists many broken renditions
 * cannot exhaust the candidate cap before the fallback is ever reached.
 */
async function downloadWithTranscodeFallback(gif: Gif, targets: Array<GifDownloadTarget>): Promise<File> {
	const baseName = sanitizeGifFileBaseName(gif);
	try {
		return await downloadFirstAvailableTarget(targets, baseName);
	} catch {
		return await downloadFirstAvailableTarget(collectTranscodeTargets(gif), baseName);
	}
}

export async function downloadGifAsImageFile(gif: Gif): Promise<File> {
	return downloadWithTranscodeFallback(gif, collectImageTargets(gif));
}

export async function downloadGifAsVideoOrImageFile(gif: Gif): Promise<File> {
	return downloadWithTranscodeFallback(gif, [...collectVideoTargets(gif), ...collectImageTargets(gif)]);
}
