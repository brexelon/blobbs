// SPDX-License-Identifier: AGPL-3.0-or-later

import type {DecodedFrame} from '@app/features/platform/utils/LibFluxcore';

/**
 * A clip a video-first provider hands us, in the order it is worth trying. The content type
 * decides whether the browser can decode it at all, so it travels with the URL.
 */
export interface ClipTranscodeSource {
	url: string;
	contentType: string;
}

/** Longest edge of the encoded GIF. Clips are scaled down to it and never scaled up to it. */
const MAX_EDGE = 640;
const TARGET_FPS = 12;
/** Three seconds at the target rate, which covers a GIF-length clip without a minute-long encode. */
const MAX_FRAMES = 36;
/** Uploads cap at 10 MB and the crop step re-encodes what we hand it, so stay under the cap. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 10_000;
const SEEK_TIMEOUT_MS = 3_000;
/** A per-seek timeout alone would let a slow clip hold the picker for minutes. */
const CLIP_BUDGET_MS = 20_000;
/** A provider that lists many clip renditions should not stall the picker on all of them. */
const MAX_SOURCE_ATTEMPTS = 3;

interface CapturePlan {
	frameCount: number;
	frameIntervalSeconds: number;
	delayMs: number;
	width: number;
	height: number;
}

function canDecodeClips(): boolean {
	return typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

function waitForEvent(target: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			window.clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			target.removeEventListener('error', onError);
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error(`Clip failed to ${event}`));
		};
		const timer = window.setTimeout(() => {
			cleanup();
			reject(new Error(`Clip timed out waiting for ${event}`));
		}, timeoutMs);
		target.addEventListener(event, onEvent, {once: true});
		target.addEventListener('error', onError, {once: true});
	});
}

function planCapture(video: HTMLVideoElement): CapturePlan | null {
	const duration = video.duration;
	const sourceWidth = video.videoWidth;
	const sourceHeight = video.videoHeight;
	if (!Number.isFinite(duration) || duration <= 0) return null;
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;
	const frameIntervalSeconds = 1 / TARGET_FPS;
	const frameCount = Math.max(2, Math.min(MAX_FRAMES, Math.round(duration * TARGET_FPS)));
	const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
	return {
		frameCount,
		frameIntervalSeconds,
		delayMs: Math.round(frameIntervalSeconds * 1000),
		width: Math.max(1, Math.round(sourceWidth * scale)),
		height: Math.max(1, Math.round(sourceHeight * scale)),
	};
}

async function captureFrames(
	video: HTMLVideoElement,
	plan: CapturePlan,
	deadline: number,
): Promise<Array<DecodedFrame>> {
	const canvas = document.createElement('canvas');
	canvas.width = plan.width;
	canvas.height = plan.height;
	const context = canvas.getContext('2d', {willReadFrequently: true});
	if (!context) throw new Error('Clip transcode needs a 2d context');
	const frames: Array<DecodedFrame> = [];
	for (let index = 0; index < plan.frameCount; index += 1) {
		if (Date.now() > deadline) throw new Error('Clip took too long to decode');
		// The final frame sits a hair inside the clip: seeking to the exact duration lands past
		// the last decoded frame on some browsers and never reports a seek.
		const timestamp = Math.min(index * plan.frameIntervalSeconds, Math.max(0, video.duration - 0.001));
		video.currentTime = timestamp;
		await waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS);
		context.drawImage(video, 0, 0, plan.width, plan.height);
		const {data} = context.getImageData(0, 0, plan.width, plan.height);
		frames.push({
			rgba: new Uint8Array(data.buffer.slice(0)),
			width: plan.width,
			height: plan.height,
			delayMs: plan.delayMs,
		});
	}
	return frames;
}

/** Halving the frame rate is the cheapest way to bring an oversized encode under the cap. */
function halveFrameRate(frames: Array<DecodedFrame>): Array<DecodedFrame> {
	return frames.filter((_frame, index) => index % 2 === 0).map((frame) => ({...frame, delayMs: frame.delayMs * 2}));
}

async function encodeFramesAsGif(frames: Array<DecodedFrame>): Promise<Uint8Array | null> {
	const {encodeGifFrames, ensureLibfluxcoreReady, releaseLibfluxcoreMemoryIfIdle} = await import(
		'@app/features/platform/utils/LibFluxcore'
	);
	await ensureLibfluxcoreReady();
	try {
		const encoded = encodeGifFrames(frames);
		if (encoded.byteLength <= MAX_OUTPUT_BYTES) return encoded;
		if (frames.length < 4) return null;
		const halved = encodeGifFrames(halveFrameRate(frames));
		return halved.byteLength <= MAX_OUTPUT_BYTES ? halved : null;
	} finally {
		releaseLibfluxcoreMemoryIfIdle();
	}
}

async function transcodeOneClip(source: ClipTranscodeSource): Promise<Uint8Array | null> {
	const deadline = Date.now() + CLIP_BUDGET_MS;
	const video = document.createElement('video');
	if (video.canPlayType(source.contentType) === '') return null;
	const response = await fetch(source.url);
	if (!response.ok) return null;
	const blob = await response.blob();
	if (blob.size === 0) return null;
	// A blob URL is same-origin, so reading the drawn frames back out of the canvas stays legal
	// no matter which host the clip came from.
	const objectUrl = URL.createObjectURL(blob);
	video.muted = true;
	video.playsInline = true;
	video.preload = 'auto';
	video.crossOrigin = 'anonymous';
	video.src = objectUrl;
	try {
		await waitForEvent(video, 'loadeddata', METADATA_TIMEOUT_MS);
		const plan = planCapture(video);
		if (!plan) return null;
		return await encodeFramesAsGif(await captureFrames(video, plan, deadline));
	} finally {
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(objectUrl);
	}
}

/**
 * Turn the first decodable clip into an animated GIF. Returns null when the browser cannot
 * decode any of them, which leaves the caller free to fall back to a still frame.
 */
export async function transcodeClipToAnimatedGifFile(
	sources: ReadonlyArray<ClipTranscodeSource>,
	baseName: string,
): Promise<File | null> {
	if (!canDecodeClips()) return null;
	const seenUrls = new Set<string>();
	let attempts = 0;
	for (const source of sources) {
		if (attempts >= MAX_SOURCE_ATTEMPTS) break;
		if (seenUrls.has(source.url)) continue;
		seenUrls.add(source.url);
		attempts += 1;
		try {
			const encoded = await transcodeOneClip(source);
			if (encoded && encoded.byteLength > 0) {
				return new File([new Uint8Array(encoded)], `${baseName}.gif`, {type: 'image/gif'});
			}
		} catch {}
	}
	return null;
}
