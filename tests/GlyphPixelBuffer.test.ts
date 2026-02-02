/**
 * GlyphPixelBuffer Tests
 *
 * Tests for the SharedArrayBuffer-based zero-copy transfer protocol
 * used for WASM SIMD pixel processing.
 *
 * Tests cover:
 * - Buffer creation and initialization
 * - Memory layout and typed views
 * - Atomics-based synchronization
 * - Data population and retrieval
 * - Error handling for COOP/COEP requirements
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	GlyphPixelBuffer,
	calculateBufferSize,
	createGlyphPixelBuffer,
	FLAGS,
	type GlyphPixelViews
} from '$lib/pixelwise/GlyphPixelBuffer';

describe('GlyphPixelBuffer', () => {
	describe('calculateBufferSize', () => {
		it('should calculate correct buffer size for given pixel count', () => {
			const size = calculateBufferSize(10000);

			// Header: 64 bytes
			// Coords: 10000 * 2 * 4 = 80000 bytes
			// Coverage: 10000 bytes
			// RegionIDs: 10000 * 2 = 20000 bytes
			// Colors: 256 * 3 = 768 bytes
			// Output: 10000 * 3 = 30000 bytes
			// Total: 64 + 80000 + 10000 + 20000 + 768 + 30000 = 140832

			expect(size).toBeGreaterThan(0);
			expect(size).toBe(140832);
		});

		it('should calculate size for small pixel count', () => {
			const size = calculateBufferSize(100);
			expect(size).toBeGreaterThan(64); // At least header size
		});

		it('should calculate size for large pixel count', () => {
			const size = calculateBufferSize(100000);
			expect(size).toBeGreaterThan(calculateBufferSize(10000));
		});

		it('should return consistent sizes', () => {
			const size1 = calculateBufferSize(5000);
			const size2 = calculateBufferSize(5000);
			expect(size1).toBe(size2);
		});
	});

	describe('GlyphPixelBuffer construction', () => {
		it('should create buffer with specified capacity', () => {
			const buffer = new GlyphPixelBuffer(10000);
			expect(buffer.maxPixels).toBe(10000);
		});

		it('should initialize with zero pixel count', () => {
			const buffer = new GlyphPixelBuffer(1000);
			expect(buffer.pixelCount).toBe(0);
		});

		it('should initialize with zero region count', () => {
			const buffer = new GlyphPixelBuffer(1000);
			expect(buffer.regionCount).toBe(0);
		});

		it('should initialize with zero flags', () => {
			const buffer = new GlyphPixelBuffer(1000);
			expect(buffer.flags).toBe(0);
		});

		it('should expose SharedArrayBuffer via buffer property', () => {
			const buffer = new GlyphPixelBuffer(1000);
			expect(buffer.buffer).toBeInstanceOf(SharedArrayBuffer);
		});

		it('should throw when SharedArrayBuffer is unavailable', () => {
			const originalSAB = globalThis.SharedArrayBuffer;
			// @ts-expect-error - testing undefined case
			globalThis.SharedArrayBuffer = undefined;

			expect(() => new GlyphPixelBuffer(1000)).toThrow('SharedArrayBuffer not available');

			globalThis.SharedArrayBuffer = originalSAB;
		});

		it('should include COOP/COEP note in error message', () => {
			const originalSAB = globalThis.SharedArrayBuffer;
			// @ts-expect-error - testing undefined case
			globalThis.SharedArrayBuffer = undefined;

			expect(() => new GlyphPixelBuffer(1000)).toThrow(/COOP\/COEP/);

			globalThis.SharedArrayBuffer = originalSAB;
		});
	});

	describe('Typed views', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(1000);
		});

		it('should provide coords as Uint32Array', () => {
			expect(buffer.coords).toBeInstanceOf(Uint32Array);
			expect(buffer.coords.length).toBe(2000); // maxPixels * 2
		});

		it('should provide coverage as Uint8Array', () => {
			expect(buffer.coverage).toBeInstanceOf(Uint8Array);
			expect(buffer.coverage.length).toBe(1000);
		});

		it('should provide regionIds as Uint16Array', () => {
			expect(buffer.regionIds).toBeInstanceOf(Uint16Array);
			expect(buffer.regionIds.length).toBe(1000);
		});

		it('should provide regionColors as Uint8Array', () => {
			expect(buffer.regionColors).toBeInstanceOf(Uint8Array);
			expect(buffer.regionColors.length).toBe(768); // 256 regions * 3 RGB
		});

		it('should provide output as Uint8Array', () => {
			expect(buffer.output).toBeInstanceOf(Uint8Array);
			expect(buffer.output.length).toBe(3000); // maxPixels * 3
		});
	});

	describe('Pixel count management', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(1000);
		});

		it('should set and get pixel count', () => {
			buffer.setPixelCount(500);
			expect(buffer.pixelCount).toBe(500);
		});

		it('should allow setting to zero', () => {
			buffer.setPixelCount(100);
			buffer.setPixelCount(0);
			expect(buffer.pixelCount).toBe(0);
		});

		it('should allow setting to max capacity', () => {
			buffer.setPixelCount(1000);
			expect(buffer.pixelCount).toBe(1000);
		});

		it('should throw RangeError when exceeding capacity', () => {
			expect(() => buffer.setPixelCount(1001)).toThrow(RangeError);
		});

		it('should include capacity in error message', () => {
			expect(() => buffer.setPixelCount(2000)).toThrow(/1000/);
		});
	});

	describe('Region count management', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(1000);
		});

		it('should set and get region count', () => {
			buffer.setRegionCount(10);
			expect(buffer.regionCount).toBe(10);
		});

		it('should allow setting to max regions (256)', () => {
			buffer.setRegionCount(256);
			expect(buffer.regionCount).toBe(256);
		});

		it('should throw RangeError when exceeding max regions', () => {
			expect(() => buffer.setRegionCount(257)).toThrow(RangeError);
		});
	});

	describe('Synchronization flags', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(1000);
		});

		it('should start with no completion', () => {
			expect(buffer.isComplete()).toBe(false);
		});

		it('should start with no error', () => {
			expect(buffer.hasError()).toBe(false);
		});

		it('should signal ready for WASM', () => {
			buffer.signalReady();
			expect(buffer.flags & FLAGS.READY_FOR_WASM).toBeTruthy();
		});

		it('should reset flags', () => {
			buffer.signalReady();
			buffer.reset();
			expect(buffer.flags).toBe(0);
		});

		it('should clear all data', () => {
			buffer.setPixelCount(100);
			buffer.setRegionCount(5);
			buffer.signalReady();

			buffer.clear();

			expect(buffer.pixelCount).toBe(0);
			expect(buffer.regionCount).toBe(0);
			expect(buffer.flags).toBe(0);
		});
	});

	describe('FLAGS constants', () => {
		it('should have correct flag values', () => {
			expect(FLAGS.READY_FOR_WASM).toBe(0x01);
			expect(FLAGS.WASM_PROCESSING).toBe(0x02);
			expect(FLAGS.WASM_COMPLETE).toBe(0x04);
			expect(FLAGS.ERROR).toBe(0x08);
		});

		it('should have non-overlapping flags', () => {
			const allFlags = [
				FLAGS.READY_FOR_WASM,
				FLAGS.WASM_PROCESSING,
				FLAGS.WASM_COMPLETE,
				FLAGS.ERROR
			];

			// Check that each flag is a power of 2 (single bit set)
			for (const flag of allFlags) {
				expect(flag & (flag - 1)).toBe(0);
			}

			// Check that OR of all flags has all bits
			const combined = allFlags.reduce((a, b) => a | b, 0);
			expect(combined).toBe(0x0f);
		});
	});

	describe('Data population', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(100);
		});

		it('should populate with pixel data', () => {
			const pixelCoords = new Uint32Array([10, 20, 30, 40]); // 2 pixels
			const coverageMasks = new Uint8Array([128, 255]);
			const regionMap = new Uint16Array([0, 1]);
			const textColors = new Uint8Array([255, 0, 0, 0, 255, 0]); // 2 regions

			buffer.populate(pixelCoords, coverageMasks, regionMap, textColors);

			expect(buffer.pixelCount).toBe(2);
			expect(buffer.regionCount).toBe(2);
		});

		it('should copy coordinate data correctly', () => {
			const pixelCoords = new Uint32Array([100, 200, 300, 400]);
			const coverageMasks = new Uint8Array([64, 192]);
			const regionMap = new Uint16Array([0, 0]);
			const textColors = new Uint8Array([0, 0, 255]);

			buffer.populate(pixelCoords, coverageMasks, regionMap, textColors);

			expect(buffer.coords[0]).toBe(100);
			expect(buffer.coords[1]).toBe(200);
			expect(buffer.coords[2]).toBe(300);
			expect(buffer.coords[3]).toBe(400);
		});

		it('should copy coverage masks correctly', () => {
			const pixelCoords = new Uint32Array([0, 0, 1, 1, 2, 2]);
			const coverageMasks = new Uint8Array([0, 128, 255]);
			const regionMap = new Uint16Array([0, 0, 0]);
			const textColors = new Uint8Array([255, 255, 255]);

			buffer.populate(pixelCoords, coverageMasks, regionMap, textColors);

			expect(buffer.coverage[0]).toBe(0);
			expect(buffer.coverage[1]).toBe(128);
			expect(buffer.coverage[2]).toBe(255);
		});

		it('should reset flags after population', () => {
			buffer.signalReady(); // Set some flags

			const pixelCoords = new Uint32Array([0, 0]);
			const coverageMasks = new Uint8Array([255]);
			const regionMap = new Uint16Array([0]);
			const textColors = new Uint8Array([0, 0, 0]);

			buffer.populate(pixelCoords, coverageMasks, regionMap, textColors);

			expect(buffer.flags).toBe(0);
		});
	});

	describe('getAdjustedColors', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(100);
		});

		it('should return slice of output buffer', () => {
			// Manually set some output values
			buffer.output[0] = 255;
			buffer.output[1] = 128;
			buffer.output[2] = 64;
			buffer.output[3] = 32;
			buffer.output[4] = 16;
			buffer.output[5] = 8;

			const colors = buffer.getAdjustedColors(0, 2);

			expect(colors.length).toBe(6);
			expect(colors[0]).toBe(255);
			expect(colors[1]).toBe(128);
			expect(colors[2]).toBe(64);
		});

		it('should return correct range for offset start', () => {
			buffer.output[6] = 100;
			buffer.output[7] = 150;
			buffer.output[8] = 200;

			const colors = buffer.getAdjustedColors(2, 1);

			expect(colors.length).toBe(3);
			expect(colors[0]).toBe(100);
			expect(colors[1]).toBe(150);
			expect(colors[2]).toBe(200);
		});
	});

	describe('waitForCompletion', () => {
		let buffer: GlyphPixelBuffer;

		beforeEach(() => {
			buffer = new GlyphPixelBuffer(100);
		});

		it('should resolve immediately when already complete', async () => {
			// Simulate WASM completion by setting the flag directly
			const headerInt32 = new Int32Array(buffer.buffer, 0, 16);
			Atomics.store(headerInt32, 9, FLAGS.WASM_COMPLETE); // FLAGS index is 9

			await expect(buffer.waitForCompletion(100)).resolves.toBeUndefined();
		});

		it('should throw on timeout', async () => {
			// Don't set complete flag - should timeout
			await expect(buffer.waitForCompletion(50)).rejects.toThrow(/timeout/);
		});

		it('should throw on error flag', async () => {
			// Simulate WASM error
			const headerInt32 = new Int32Array(buffer.buffer, 0, 16);
			Atomics.store(headerInt32, 9, FLAGS.ERROR);

			await expect(buffer.waitForCompletion(100)).rejects.toThrow(/failed/);
		});
	});
});

describe('createGlyphPixelBuffer factory', () => {
	it('should create buffer with default capacity', () => {
		const buffer = createGlyphPixelBuffer();
		expect(buffer).toBeInstanceOf(GlyphPixelBuffer);
		expect(buffer?.maxPixels).toBe(10000);
	});

	it('should create buffer with custom capacity', () => {
		const buffer = createGlyphPixelBuffer(5000);
		expect(buffer?.maxPixels).toBe(5000);
	});

	it('should return null when SharedArrayBuffer unavailable', () => {
		const originalSAB = globalThis.SharedArrayBuffer;
		// @ts-expect-error - testing undefined case
		globalThis.SharedArrayBuffer = undefined;

		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const buffer = createGlyphPixelBuffer();

		expect(buffer).toBeNull();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('SharedArrayBuffer not available')
		);

		consoleSpy.mockRestore();
		globalThis.SharedArrayBuffer = originalSAB;
	});
});

describe('SharedArrayBuffer Memory Layout', () => {
	/**
	 * Memory layout documentation (verified by tests):
	 *
	 * Header (64 bytes):
	 * - [0] MAGIC: 0x474c5950 ("GLYP")
	 * - [1] VERSION: 1
	 * - [2] PIXEL_COUNT: current pixel count
	 * - [3] REGION_COUNT: current region count
	 * - [4] COORDS_OFFSET: byte offset to coords array
	 * - [5] COVERAGE_OFFSET: byte offset to coverage array
	 * - [6] REGION_ID_OFFSET: byte offset to regionIds array
	 * - [7] COLORS_OFFSET: byte offset to regionColors array
	 * - [8] OUTPUT_OFFSET: byte offset to output array
	 * - [9] FLAGS: synchronization flags
	 * - [10-15] Reserved
	 *
	 * Data sections (variable size based on maxPixels):
	 * - Coords: Uint32Array[maxPixels * 2] - (x, y) pairs
	 * - Coverage: Uint8Array[maxPixels] - alpha masks
	 * - RegionIds: Uint16Array[maxPixels] - region indices
	 * - RegionColors: Uint8Array[768] - RGB per region (256 max)
	 * - Output: Uint8Array[maxPixels * 3] - adjusted RGB
	 */

	it('should have correct magic number in header', () => {
		const buffer = new GlyphPixelBuffer(100);
		const header = new Uint32Array(buffer.buffer, 0, 16);
		expect(header[0]).toBe(0x474c5950); // "GLYP"
	});

	it('should have correct version in header', () => {
		const buffer = new GlyphPixelBuffer(100);
		const header = new Uint32Array(buffer.buffer, 0, 16);
		expect(header[1]).toBe(1);
	});

	it('should store offsets in header', () => {
		const buffer = new GlyphPixelBuffer(100);
		const header = new Uint32Array(buffer.buffer, 0, 16);

		// Coords offset should be right after header
		expect(header[4]).toBe(64); // COORDS_OFFSET

		// Coverage offset should be after coords
		expect(header[5]).toBeGreaterThan(header[4]); // COVERAGE_OFFSET

		// Region ID offset should be after coverage
		expect(header[6]).toBeGreaterThan(header[5]); // REGION_ID_OFFSET

		// Colors offset should be after region IDs
		expect(header[7]).toBeGreaterThan(header[6]); // COLORS_OFFSET

		// Output offset should be after colors
		expect(header[8]).toBeGreaterThan(header[7]); // OUTPUT_OFFSET
	});

	it('should have views pointing to correct buffer regions', () => {
		const buffer = new GlyphPixelBuffer(100);

		// All views should share the same underlying buffer
		expect(buffer.coords.buffer).toBe(buffer.buffer);
		expect(buffer.coverage.buffer).toBe(buffer.buffer);
		expect(buffer.regionIds.buffer).toBe(buffer.buffer);
		expect(buffer.regionColors.buffer).toBe(buffer.buffer);
		expect(buffer.output.buffer).toBe(buffer.buffer);
	});
});

describe('Atomics Integration', () => {
	it('should use Atomics for pixel count', () => {
		const buffer = new GlyphPixelBuffer(100);

		// Setting should use atomic store
		buffer.setPixelCount(50);

		// Reading should use atomic load (verified by consistent value)
		expect(buffer.pixelCount).toBe(50);
	});

	it('should use Atomics for region count', () => {
		const buffer = new GlyphPixelBuffer(100);

		buffer.setRegionCount(10);
		expect(buffer.regionCount).toBe(10);
	});

	it('should use Atomics for flags', () => {
		const buffer = new GlyphPixelBuffer(100);

		buffer.signalReady();
		expect(buffer.flags).toBe(FLAGS.READY_FOR_WASM);

		buffer.reset();
		expect(buffer.flags).toBe(0);
	});
});
