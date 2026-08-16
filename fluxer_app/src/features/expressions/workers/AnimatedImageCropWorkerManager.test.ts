// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	__setNativeBridgeForTesting,
	type NativeBridge,
	type NativeFrame,
} from '@app/features/messaging/utils/MediaNativeBridge';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cropImageWithSource, getWorkerManager} from './AnimatedImageCropWorkerManager';

const encodeGifFrames = vi.hoisted(() => vi.fn(() => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])));

vi.mock('@app/features/platform/utils/LibFluxcore', () => ({
	encodeGifFrames,
	ensureLibfluxcoreReady: async () => {},
	releaseLibfluxcoreMemoryIfIdle: () => {},
	cropRotateRgba: (rgba: Uint8Array, _width: number, _height: number, ...rest: Array<number>) => ({
		rgba,
		width: rest[2],
		height: rest[3],
	}),
}));

const FRAME_DURATION_MICROSECONDS = 100_000;

function stubImageDecoder(frameCount: number, width = 64, height = 32): void {
	class FakeImageDecoder {
		completed = Promise.resolve();
		tracks = {selectedTrack: {animated: frameCount > 1, frameCount}};
		async decode() {
			return {
				image: {displayWidth: width, displayHeight: height, duration: FRAME_DURATION_MICROSECONDS, close: () => {}},
				complete: true,
			};
		}
		close() {}
		static async isTypeSupported() {
			return true;
		}
	}
	vi.stubGlobal('ImageDecoder', FakeImageDecoder);
}

function stubCanvas(): void {
	class FakeOffscreenCanvas {
		constructor(
			public width: number,
			public height: number,
		) {}
		getContext() {
			return {
				drawImage: () => {},
				putImageData: () => {},
				getImageData: (_x: number, _y: number, width: number, height: number) => ({
					data: new Uint8ClampedArray(width * height * 4),
				}),
			};
		}
		async convertToBlob() {
			return new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])]);
		}
	}
	vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
	vi.stubGlobal(
		'ImageData',
		class {
			constructor(
				public data: Uint8ClampedArray,
				public width: number,
				public height: number,
			) {}
		},
	);
}

function nativeBridge(): NativeBridge {
	return {
		sniff: () => ({mime: 'image/webp', animated: true, frames: 3}),
		decodeImage: () => ({
			frames: Array.from({length: 3}, () => ({rgba: new Uint8Array(64 * 32 * 4), width: 64, height: 32, delayMs: 100})),
			width: 64,
			height: 32,
			hasAlpha: true,
		}),
		decodeHeic: () => ({rgba: new Uint8Array(), width: 0, height: 0, delayMs: 0}),
		decodeJxl: () => ({rgba: new Uint8Array(), width: 0, height: 0, delayMs: 0}),
		encodeAnimatedWebp: () => new Uint8Array([0x52, 0x49, 0x46, 0x46]),
		encodeAnimatedApng: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
		encodeAvif: () => new Uint8Array([0x61, 0x76, 0x69, 0x66]),
	};
}

const WEBP_SOURCE = {bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), mime: 'image/webp'};
const CROP = {x: 0, y: 0, width: 64, height: 32};

beforeEach(() => {
	encodeGifFrames.mockClear();
	stubCanvas();
	__setNativeBridgeForTesting(null);
});

afterEach(() => {
	getWorkerManager().terminate();
	__setNativeBridgeForTesting(null);
	vi.unstubAllGlobals();
});

describe('cropping an animated image the browser cannot re-encode', () => {
	it('answers with a GIF rather than failing when there is no native bridge', async () => {
		stubImageDecoder(3);
		const result = await cropImageWithSource(WEBP_SOURCE, CROP);
		expect(result.contentType).toBe('image/gif');
		expect(Array.from(result.bytes.slice(0, 3))).toEqual([0x47, 0x49, 0x46]);
	});

	it('hands every decoded frame and its delay to the GIF encoder', async () => {
		stubImageDecoder(3);
		await cropImageWithSource(WEBP_SOURCE, CROP);
		const [frames] = encodeGifFrames.mock.calls[0] as unknown as [Array<NativeFrame>];
		expect(frames).toHaveLength(3);
		expect(frames.every((frame) => frame.delayMs === 100)).toBe(true);
	});

	it('keeps the cropped geometry in the frames it encodes', async () => {
		stubImageDecoder(2);
		await cropImageWithSource(WEBP_SOURCE, {x: 4, y: 4, width: 32, height: 16});
		const [frames] = encodeGifFrames.mock.calls[0] as unknown as [Array<NativeFrame>];
		expect(frames[0]).toMatchObject({width: 32, height: 16});
	});

	it('still prefers animated WebP where the desktop bridge can encode it', async () => {
		stubImageDecoder(3);
		__setNativeBridgeForTesting(nativeBridge());
		const result = await cropImageWithSource(WEBP_SOURCE, CROP);
		expect(result.contentType).toBe('image/webp');
		expect(encodeGifFrames).not.toHaveBeenCalled();
	});

	it('leaves a still image in its own container', async () => {
		stubImageDecoder(1);
		const result = await cropImageWithSource(WEBP_SOURCE, CROP);
		expect(result.contentType).toBe('image/webp');
		expect(encodeGifFrames).not.toHaveBeenCalled();
	});

	it('reports an unsupported source instead of guessing a container', async () => {
		stubImageDecoder(1);
		await expect(cropImageWithSource({bytes: new Uint8Array(4), mime: 'image/heic'}, CROP)).rejects.toThrow(
			'HEIC decode requires the desktop app or a Safari browser',
		);
	});
});
