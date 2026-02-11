/**
 * Futhark WebGPU Performance Benchmarks
 *
 * Benchmarks the unified Futhark WebGPU pipeline performance.
 *
 * Prerequisites:
 *   1. Build Futhark WebGPU: just futhark-webgpu-build
 *   2. Compile pipeline: just futhark-webgpu-compile
 *
 * Run with: just bench-webgpu
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock SvelteKit virtual modules (required for dynamic import of ComputeDispatcher)
vi.mock('$app/environment', () => ({
	browser: true
}));

vi.mock('$lib/pixelwise/shaders/video-capture-esdt.wgsl?raw', () => ({
	default: '// mock video capture shader'
}));
vi.mock('$lib/pixelwise/shaders/video-capture-esdt-fallback.wgsl?raw', () => ({
	default: '// mock fallback shader'
}));

/**
 * Benchmark configuration
 */
const WARMUP_ITERATIONS = 3;
const BENCHMARK_ITERATIONS = 10;

/**
 * Test resolutions
 */
const RESOLUTIONS = [
	{ width: 64, height: 64, name: '64x64' },
	{ width: 256, height: 256, name: '256x256' },
	{ width: 512, height: 512, name: '512x512' },
	{ width: 1920, height: 1080, name: '1080p' },
] as const;

/**
 * Benchmark result
 */
interface BenchmarkResult {
	name: string;
	resolution: string;
	iterations: number;
	times: number[];
	minTime: number;
	maxTime: number;
	avgTime: number;
	medianTime: number;
	stdDev: number;
	pixelCount: number;
	throughput: number; // pixels per second
}

/**
 * Generate test image data
 */
function generateTestImage(width: number, height: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;

			// Create a pattern similar to text on background
			const inTextRegion =
				x > width * 0.1 && x < width * 0.9 &&
				y > height * 0.2 && y < height * 0.8;

			if (inTextRegion && (x + y) % 7 === 0) {
				// Dark "text" pixels
				data[idx] = 20;
				data[idx + 1] = 20;
				data[idx + 2] = 20;
			} else {
				// Light background
				data[idx] = 240;
				data[idx + 1] = 240;
				data[idx + 2] = 240;
			}
			data[idx + 3] = 255;
		}
	}

	return data;
}

/**
 * Calculate statistics from timing array
 */
function calculateStats(times: number[]): { minTime: number; maxTime: number; avgTime: number; medianTime: number; stdDev: number } {
	const sorted = [...times].sort((a, b) => a - b);
	const sum = times.reduce((a, b) => a + b, 0);
	const avg = sum / times.length;

	const squaredDiffs = times.map(t => Math.pow(t - avg, 2));
	const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / times.length;
	const stdDev = Math.sqrt(avgSquaredDiff);

	return {
		minTime: sorted[0],
		maxTime: sorted[sorted.length - 1],
		avgTime: avg,
		medianTime: sorted[Math.floor(sorted.length / 2)],
		stdDev
	};
}

/**
 * Run benchmark for a single configuration
 */
async function runBenchmark(
	name: string,
	resolution: string,
	pixelCount: number,
	fn: () => Promise<void>
): Promise<BenchmarkResult> {
	const times: number[] = [];

	// Warmup
	for (let i = 0; i < WARMUP_ITERATIONS; i++) {
		await fn();
	}

	// Benchmark
	for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
		const start = performance.now();
		await fn();
		const end = performance.now();
		times.push(end - start);
	}

	const stats = calculateStats(times);
	const throughput = pixelCount / (stats.avgTime / 1000);

	return {
		name,
		resolution,
		iterations: BENCHMARK_ITERATIONS,
		times,
		pixelCount,
		throughput,
		...stats
	};
}

/**
 * Format time for display
 */
function formatTime(ms: number): string {
	if (ms < 0.01) {
		return `${(ms * 1000).toFixed(1)}us`;
	} else if (ms < 1000) {
		return `${ms.toFixed(2)}ms`;
	} else {
		return `${(ms / 1000).toFixed(2)}s`;
	}
}

/**
 * Print benchmark result
 */
function printResult(result: BenchmarkResult): void {
	console.log(`
  ${result.name} @ ${result.resolution}
  -----------------------------
  Avg: ${formatTime(result.avgTime)}
  Min: ${formatTime(result.minTime)}
  Max: ${formatTime(result.maxTime)}
  Median: ${formatTime(result.medianTime)}
  StdDev: ${formatTime(result.stdDev)}
  Throughput: ${(result.throughput / 1e6).toFixed(2)} Mpixels/sec
`);
}

describe('Futhark WebGPU Performance Benchmarks', () => {
	// Skip if no real WebGPU runtime (jsdom doesn't provide navigator.gpu)
	const hasWebGPURuntime = typeof navigator !== 'undefined' && 'gpu' in navigator;

	describe.skipIf(!hasWebGPURuntime)('Pipeline Performance', () => {
		let dispatcher: any;
		let webgpuAvailable = false;
		let futharkWebGPUAvailable = false;

		beforeAll(async () => {
			try {
				const { createComputeDispatcher } = await import('$lib/core/ComputeDispatcher');

				dispatcher = createComputeDispatcher();
				await dispatcher.initialize('webgpu');
				webgpuAvailable = dispatcher.hasWebGPU;
				futharkWebGPUAvailable = dispatcher.hasFutharkWebGPU;

				if (!webgpuAvailable) {
					console.warn('WebGPU not available, skipping benchmarks');
				}

				if (!futharkWebGPUAvailable) {
					console.warn('Futhark WebGPU not available. Run: just futhark-webgpu-compile');
				}
			} catch (err) {
				console.error('Failed to initialize dispatcher:', err);
			}
		});

		afterAll(() => {
			if (dispatcher) {
				dispatcher.destroy();
			}
		});

		it('should have WebGPU available for benchmarking', () => {
			expect(webgpuAvailable).toBe(true);
		});

		it.skipIf(!futharkWebGPUAvailable)('should have Futhark WebGPU available', () => {
			expect(futharkWebGPUAvailable).toBe(true);
		});

		for (const resolution of RESOLUTIONS) {
			it.skipIf(!futharkWebGPUAvailable)(`should benchmark Futhark WebGPU pipeline at ${resolution.name}`, async () => {
				if (!webgpuAvailable || !futharkWebGPUAvailable) {
					return;
				}

				const testImage = generateTestImage(resolution.width, resolution.height);
				const pixelCount = resolution.width * resolution.height;

				const result = await runBenchmark(
					'Futhark WebGPU',
					resolution.name,
					pixelCount,
					async () => {
						await dispatcher.runFullPipeline(testImage, resolution.width, resolution.height);
					}
				);

				printResult(result);

				expect(result.avgTime).toBeGreaterThan(0);
				expect(result.iterations).toBe(BENCHMARK_ITERATIONS);
				expect(result.throughput).toBeGreaterThan(0);
			});
		}

		it('should benchmark initialization time', async () => {
			if (!webgpuAvailable) {
				return;
			}

			const { createComputeDispatcher } = await import('$lib/core/ComputeDispatcher');

			const initTimes: number[] = [];

			for (let i = 0; i < 5; i++) {
				const newDispatcher = createComputeDispatcher();
				const start = performance.now();
				await newDispatcher.initialize('webgpu');
				const end = performance.now();
				initTimes.push(end - start);
				newDispatcher.destroy();
			}

			const stats = calculateStats(initTimes);

			console.log(`
  Initialization Benchmark
  ------------------------
  Avg: ${formatTime(stats.avgTime)}
  Min: ${formatTime(stats.minTime)}
  Max: ${formatTime(stats.maxTime)}
  StdDev: ${formatTime(stats.stdDev)}
`);

			expect(stats.avgTime).toBeLessThan(5000); // Should initialize in under 5 seconds
		});

		it.skipIf(!futharkWebGPUAvailable)('should compare throughput at various resolutions', async () => {
			if (!webgpuAvailable || !futharkWebGPUAvailable) {
				return;
			}

			console.log(`
  =====================================
  FUTHARK WEBGPU THROUGHPUT SUMMARY
  =====================================
`);

			const results: Array<{ name: string; throughput: number }> = [];

			for (const resolution of RESOLUTIONS) {
				const testImage = generateTestImage(resolution.width, resolution.height);
				const pixelCount = resolution.width * resolution.height;

				const start = performance.now();
				for (let i = 0; i < 10; i++) {
					await dispatcher.runFullPipeline(testImage, resolution.width, resolution.height);
				}
				const end = performance.now();
				const throughput = (pixelCount * 10) / ((end - start) / 1000);

				results.push({ name: resolution.name, throughput });

				console.log(`  ${resolution.name}: ${(throughput / 1e6).toFixed(2)} Mpixels/sec`);
			}

			// Verify all results have positive throughput
			for (const result of results) {
				expect(result.throughput).toBeGreaterThan(0);
			}

			// Log scaling efficiency
			if (results.length >= 2) {
				const smallest = results[0];
				const largest = results[results.length - 1];
				const pixelRatio = (RESOLUTIONS[RESOLUTIONS.length - 1].width * RESOLUTIONS[RESOLUTIONS.length - 1].height) /
					(RESOLUTIONS[0].width * RESOLUTIONS[0].height);
				const throughputRatio = largest.throughput / smallest.throughput;

				console.log(`
  Scaling Analysis:
  - Pixel ratio (${largest.name}/${smallest.name}): ${pixelRatio.toFixed(0)}x
  - Throughput ratio: ${throughputRatio.toFixed(2)}x
  - Scaling efficiency: ${((throughputRatio / pixelRatio) * 100).toFixed(1)}%
`);
			}
		});
	});

	describe('Static Analysis', () => {
		it('should have valid benchmark configuration', () => {
			expect(WARMUP_ITERATIONS).toBeGreaterThan(0);
			expect(BENCHMARK_ITERATIONS).toBeGreaterThan(0);
			expect(RESOLUTIONS.length).toBeGreaterThan(0);
		});

		it('should calculate statistics correctly', () => {
			const times = [10, 20, 30, 40, 50];
			const stats = calculateStats(times);

			expect(stats.minTime).toBe(10);
			expect(stats.maxTime).toBe(50);
			expect(stats.avgTime).toBe(30);
			expect(stats.medianTime).toBe(30);
			expect(stats.stdDev).toBeCloseTo(14.14, 1);
		});

		it('should format times correctly', () => {
			expect(formatTime(0.0005)).toBe('0.5us');
			expect(formatTime(0.5)).toBe('0.50ms');
			expect(formatTime(1.5)).toBe('1.50ms');
			expect(formatTime(1500)).toBe('1.50s');
		});

		it('should generate valid test images', () => {
			const image = generateTestImage(64, 64);
			expect(image.length).toBe(64 * 64 * 4);

			// Check that image has variety (not all same color)
			let hasLight = false;
			let hasDark = false;
			for (let i = 0; i < image.length; i += 4) {
				if (image[i] < 100) hasDark = true;
				if (image[i] > 200) hasLight = true;
			}
			expect(hasLight).toBe(true);
			expect(hasDark).toBe(true);
		});
	});
});
