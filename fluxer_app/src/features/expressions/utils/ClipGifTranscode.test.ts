// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {transcodeClipToAnimatedGifFile} from './ClipGifTranscode';

const encodeGifFrames = vi.hoisted(() => vi.fn(() => new Uint8Array(1024)));

vi.mock('@app/features/platform/utils/LibFluxcore', () => ({
	encodeGifFrames,
	ensureLibfluxcoreReady: async () => {},
	releaseLibfluxcoreMemoryIfIdle: () => {},
}));

interface FakeVideoOptions {
	playable?: boolean;
	duration?: number;
	width?: number;
	height?: number;
	failToLoad?: boolean;
}

/** The seek timestamps a fake video was asked for, in order. */
let seekedTo: Array<number> = [];
let drawnFrames = 0;

function createFakeVideo(options: FakeVideoOptions) {
	const listeners = new Map<string, Array<() => void>>();
	const emit = (event: string) => {
		for (const listener of listeners.get(event) ?? []) listener();
		listeners.delete(event);
	};
	return {
		muted: false,
		playsInline: false,
		preload: '',
		crossOrigin: null as string | null,
		duration: options.duration ?? 2,
		videoWidth: options.width ?? 480,
		videoHeight: options.height ?? 270,
		_currentTime: 0,
		get currentTime() {
			return this._currentTime;
		},
		set currentTime(value: number) {
			this._currentTime = value;
			seekedTo.push(value);
			queueMicrotask(() => emit('seeked'));
		},
		_src: '',
		get src() {
			return this._src;
		},
		set src(value: string) {
			this._src = value;
			queueMicrotask(() => emit(options.failToLoad ? 'error' : 'loadeddata'));
		},
		canPlayType: (type: string) => (options.playable === false ? '' : type === 'video/mp4' ? 'probably' : 'maybe'),
		addEventListener(event: string, listener: () => void) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
		removeEventListener(event: string, listener: () => void) {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((entry) => entry !== listener),
			);
		},
		removeAttribute: () => {},
		load: () => {},
	};
}

function createFakeCanvas() {
	return {
		width: 0,
		height: 0,
		getContext: () => ({
			drawImage: () => {
				drawnFrames += 1;
			},
			getImageData: (_x: number, _y: number, width: number, height: number) => ({
				data: new Uint8ClampedArray(width * height * 4),
			}),
		}),
	};
}

function stubBrowser(options: FakeVideoOptions = {}): void {
	vi.stubGlobal('document', {
		createElement: (tag: string) => (tag === 'video' ? createFakeVideo(options) : createFakeCanvas()),
	});
	vi.stubGlobal('window', {setTimeout, clearTimeout});
	vi.stubGlobal('URL', {createObjectURL: () => 'blob:clip', revokeObjectURL: () => {}});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ok: true, blob: async () => new Blob([new Uint8Array(2048)])}) as unknown as Response),
	);
}

const MP4_SOURCE = {url: '/media/hd.mp4', contentType: 'video/mp4'};

beforeEach(() => {
	seekedTo = [];
	drawnFrames = 0;
	encodeGifFrames.mockClear();
	encodeGifFrames.mockReturnValue(new Uint8Array(1024));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('transcodeClipToAnimatedGifFile', () => {
	it('returns null where there is no DOM to decode a clip with', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		expect(await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item')).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('encodes the clip as an animated GIF named after the item', async () => {
		stubBrowser();
		const file = await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item');
		expect(file?.name).toBe('an-item.gif');
		expect(file?.type).toBe('image/gif');
	});

	it('samples the whole clip as evenly spaced frames', async () => {
		stubBrowser({duration: 2});
		await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item');
		// Two seconds at the 12 fps target.
		expect(seekedTo).toHaveLength(24);
		expect(drawnFrames).toBe(24);
		expect(seekedTo[1]).toBeCloseTo(1 / 12);
		const [frames] = encodeGifFrames.mock.calls[0] as unknown as [Array<{delayMs: number}>];
		expect(frames.every((frame) => frame.delayMs === 83)).toBe(true);
	});

	it('caps a long clip instead of encoding every frame of it', async () => {
		stubBrowser({duration: 30});
		await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item');
		expect(seekedTo).toHaveLength(36);
	});

	it('scales a large clip down to the encode budget and keeps its aspect ratio', async () => {
		stubBrowser({width: 1920, height: 1080});
		await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item');
		const [frames] = encodeGifFrames.mock.calls[0] as unknown as [Array<{width: number; height: number}>];
		expect(frames[0]).toMatchObject({width: 640, height: 360});
	});

	it('leaves a small clip at its own size', async () => {
		stubBrowser({width: 320, height: 240});
		await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item');
		const [frames] = encodeGifFrames.mock.calls[0] as unknown as [Array<{width: number; height: number}>];
		expect(frames[0]).toMatchObject({width: 320, height: 240});
	});

	it('skips a clip the browser reports it cannot play', async () => {
		stubBrowser({playable: false});
		expect(await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item')).toBeNull();
		expect(encodeGifFrames).not.toHaveBeenCalled();
	});

	it('returns null when the clip fails to load', async () => {
		stubBrowser({failToLoad: true});
		expect(await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item')).toBeNull();
	});

	it('returns null when the clip reports no usable duration', async () => {
		stubBrowser({duration: Number.POSITIVE_INFINITY});
		expect(await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item')).toBeNull();
		expect(encodeGifFrames).not.toHaveBeenCalled();
	});

	it('abandons a clip that decodes too slowly to be worth waiting on', async () => {
		stubBrowser({duration: 3});
		const start = Date.now();
		let tick = 0;
		vi.spyOn(Date, 'now').mockImplementation(() => start + tick++ * 10_000);
		expect(await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item')).toBeNull();
		expect(encodeGifFrames).not.toHaveBeenCalled();
	});

	it('halves the frame rate rather than hand back an oversized GIF', async () => {
		stubBrowser({duration: 3});
		encodeGifFrames.mockReturnValueOnce(new Uint8Array(9 * 1024 * 1024));
		const file = await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item');
		expect(file).not.toBeNull();
		const [halved] = encodeGifFrames.mock.calls[1] as unknown as [Array<{delayMs: number}>];
		expect(halved).toHaveLength(18);
		expect(halved[0].delayMs).toBe(166);
	});

	it('gives up when even the halved GIF is too large', async () => {
		stubBrowser({duration: 3});
		encodeGifFrames.mockReturnValue(new Uint8Array(9 * 1024 * 1024));
		expect(await transcodeClipToAnimatedGifFile([MP4_SOURCE], 'an-item')).toBeNull();
	});

	it('tries the next clip when one cannot be fetched', async () => {
		stubBrowser();
		const responses = [{ok: false}, {ok: true, blob: async () => new Blob([new Uint8Array(2048)])}];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responses.shift() as unknown as Response),
		);
		const file = await transcodeClipToAnimatedGifFile(
			[{url: '/media/broken.mp4', contentType: 'video/mp4'}, MP4_SOURCE],
			'an-item',
		);
		expect(file?.name).toBe('an-item.gif');
	});

	it('asks for each clip once and stops after three of them', async () => {
		stubBrowser();
		const fetchSpy = vi.fn(async () => ({ok: false}) as unknown as Response);
		vi.stubGlobal('fetch', fetchSpy);
		const sources = ['a', 'b', 'c', 'd'].map((name) => ({url: `/media/${name}.mp4`, contentType: 'video/mp4'}));
		expect(await transcodeClipToAnimatedGifFile([...sources, sources[0]], 'an-item')).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});
});
