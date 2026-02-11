<script lang="ts">
	import { createComputeDispatcher, type PipelineMetrics } from '$lib/core/ComputeDispatcher';

	interface PipelineStage {
		name: string;
		timeMs: number;
		percentage: number;
	}

	interface PerformanceData {
		fps: number;
		frameTimeMs: number;
		totalPixels: number;
		adjustedPixels: number;
		backend: string;
		mpixPerSec: number;
		pipeline: PipelineStage[];
	}

	let viewportSize = $state<'720p' | '1080p' | '1440p'>('1080p');
	let isBenchmarking = $state(false);
	let isInitializing = $state(false);
	let initError = $state<string | null>(null);
	let frameCount = $state(0);
	let rafId: number | null = null;

	const viewportSizes = {
		'720p': { width: 1280, height: 720, pixels: 921600 },
		'1080p': { width: 1920, height: 1080, pixels: 2073600 },
		'1440p': { width: 2560, height: 1440, pixels: 3686400 }
	};

	let metrics = $state<PerformanceData>({
		fps: 0,
		frameTimeMs: 0,
		totalPixels: 0,
		adjustedPixels: 0,
		backend: 'none',
		mpixPerSec: 0,
		pipeline: []
	});

	let dispatcher: ReturnType<typeof createComputeDispatcher> | null = null;
	let testImage: Uint8ClampedArray | null = null;
	let testWidth = $state(0);
	let testHeight = $state(0);

	/**
	 * Generate a synthetic test image with text-like patterns.
	 *
	 * Creates dark "letter" shapes on a light background so the ESDT
	 * pipeline has realistic glyph edges to detect and adjust.
	 */
	function generateTestImage(width: number, height: number): Uint8ClampedArray {
		const data = new Uint8ClampedArray(width * height * 4);

		// Fill with light background (off-white)
		for (let i = 0; i < data.length; i += 4) {
			data[i] = 245;     // R
			data[i + 1] = 245; // G
			data[i + 2] = 240; // B
			data[i + 3] = 255; // A
		}

		// Draw synthetic "text" blocks: dark rectangles with varying gray levels
		// to simulate text paragraphs with different contrast levels
		const lineHeight = 20;
		const charWidth = 10;
		const margin = 40;
		const lineGap = 8;

		for (let lineY = margin; lineY < height - margin; lineY += lineHeight + lineGap) {
			// Vary the text darkness per line (some will fail WCAG, some will pass)
			const lineIndex = Math.floor((lineY - margin) / (lineHeight + lineGap));
			const gray = 60 + (lineIndex % 5) * 30; // 60, 90, 120, 150, 180

			// Simulate a line of text with gaps (word spaces)
			const lineWidth = width - 2 * margin;
			let x = margin;
			while (x < margin + lineWidth) {
				// Word length: 3-8 characters
				const wordLen = 3 + ((x * 7 + lineY * 13) % 6);
				const wordWidth = wordLen * charWidth;

				for (let py = lineY; py < Math.min(lineY + lineHeight, height); py++) {
					for (let px = x; px < Math.min(x + wordWidth, width - margin); px++) {
						const idx = (py * width + px) * 4;
						data[idx] = gray;
						data[idx + 1] = gray;
						data[idx + 2] = gray;
						// Alpha stays 255
					}
				}

				x += wordWidth + charWidth; // word + space
			}
		}

		return data;
	}

	/**
	 * Derive display metrics from the dispatcher's metrics history.
	 */
	function deriveMetrics(): PerformanceData {
		if (!dispatcher) {
			return { fps: 0, frameTimeMs: 0, totalPixels: 0, adjustedPixels: 0, backend: 'none', mpixPerSec: 0, pipeline: [] };
		}

		const history = dispatcher.getMetricsHistory();
		if (history.length === 0) {
			return { fps: 0, frameTimeMs: 0, totalPixels: 0, adjustedPixels: 0, backend: 'none', mpixPerSec: 0, pipeline: [] };
		}

		const latest = history[history.length - 1];

		// Compute FPS from the most recent entries (use timestamps)
		let fps = 0;
		if (history.length >= 2) {
			// Use the last N entries to compute average FPS
			const windowSize = Math.min(history.length, 30);
			const windowStart = history[history.length - windowSize];
			const windowEnd = history[history.length - 1];
			const elapsed = windowEnd.timestamp - windowStart.timestamp;
			if (elapsed > 0) {
				fps = ((windowSize - 1) / elapsed) * 1000;
			}
		}

		// Average frame time from recent window
		const recentWindow = history.slice(-30);
		const avgFrameTime = recentWindow.reduce((s, m) => s + m.totalTimeMs, 0) / recentWindow.length;
		const avgPipeline = recentWindow.reduce((s, m) => s + m.pipelineTimeMs, 0) / recentWindow.length;
		const avgOverhead = recentWindow.reduce((s, m) => s + m.overheadTimeMs, 0) / recentWindow.length;
		const avgMpix = recentWindow.reduce((s, m) => s + m.mpixPerSec, 0) / recentWindow.length;

		// Build pipeline breakdown from measured data
		const totalTime = avgPipeline + avgOverhead;
		const pipeline: PipelineStage[] = [];

		if (totalTime > 0) {
			pipeline.push({
				name: 'Pipeline (6-pass Futhark)',
				timeMs: avgPipeline,
				percentage: (avgPipeline / totalTime) * 100
			});
			pipeline.push({
				name: 'Data Transfer + Counting',
				timeMs: avgOverhead,
				percentage: (avgOverhead / totalTime) * 100
			});
		}

		return {
			fps,
			frameTimeMs: avgFrameTime,
			totalPixels: latest.totalPixels,
			adjustedPixels: latest.adjustedPixels,
			backend: latest.backend,
			mpixPerSec: avgMpix,
			pipeline
		};
	}

	async function startBenchmark() {
		if (isBenchmarking) return;

		initError = null;
		isInitializing = true;
		frameCount = 0;

		try {
			// Create dispatcher if needed
			if (!dispatcher) {
				dispatcher = createComputeDispatcher();
				const ok = await dispatcher.initialize('auto');
				if (!ok) {
					throw new Error('Failed to initialize compute backend');
				}
			}

			// Generate test image at selected viewport size
			const viewport = viewportSizes[viewportSize];
			testWidth = viewport.width;
			testHeight = viewport.height;
			testImage = generateTestImage(testWidth, testHeight);

			dispatcher.clearMetrics();
			isInitializing = false;
			isBenchmarking = true;

			// Start the benchmark loop
			benchmarkLoop();
		} catch (err) {
			isInitializing = false;
			initError = err instanceof Error ? err.message : String(err);
			console.error('[PerformanceMetrics] Benchmark init failed:', err);
		}
	}

	async function benchmarkLoop() {
		if (!isBenchmarking || !dispatcher || !testImage) return;

		try {
			await dispatcher.runFullPipeline(testImage, testWidth, testHeight);
			frameCount++;
			metrics = deriveMetrics();
		} catch (err) {
			console.error('[PerformanceMetrics] Pipeline error:', err);
		}

		if (isBenchmarking) {
			rafId = requestAnimationFrame(() => benchmarkLoop());
		}
	}

	function stopBenchmark() {
		isBenchmarking = false;
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function resetStats() {
		stopBenchmark();
		if (dispatcher) {
			dispatcher.clearMetrics();
		}
		frameCount = 0;
		metrics = {
			fps: 0,
			frameTimeMs: 0,
			totalPixels: 0,
			adjustedPixels: 0,
			backend: 'none',
			mpixPerSec: 0,
			pipeline: []
		};
	}

	function getFpsColor(fps: number): string {
		if (fps > 25) return 'text-success-500';
		if (fps > 15) return 'text-warning-500';
		return 'text-error-500';
	}

	function getFrameTimeColor(ms: number): string {
		if (ms < 33) return 'text-success-500';
		if (ms < 50) return 'text-warning-500';
		return 'text-error-500';
	}

	function getBackendLabel(backend: string): string {
		switch (backend) {
			case 'futhark-webgpu': return 'Futhark WebGPU';
			case 'futhark-wasm': return 'Futhark WASM';
			case 'js-fallback': return 'JS Fallback';
			default: return 'None';
		}
	}

	function getBackendColor(backend: string): string {
		switch (backend) {
			case 'futhark-webgpu': return 'text-success-500';
			case 'futhark-wasm': return 'text-primary-500';
			case 'js-fallback': return 'text-warning-500';
			default: return 'text-surface-500';
		}
	}

	$effect(() => {
		return () => {
			stopBenchmark();
			if (dispatcher) {
				dispatcher.destroy();
				dispatcher = null;
			}
		};
	});
</script>

<div class="space-y-6">
	<!-- Controls -->
	<div class="flex flex-wrap gap-4 items-center">
		<button
			onclick={() => (isBenchmarking ? stopBenchmark() : startBenchmark())}
			disabled={isInitializing}
			class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if isInitializing}
				Initializing...
			{:else if isBenchmarking}
				Stop Benchmark
			{:else}
				Start Benchmark
			{/if}
		</button>

		<button
			onclick={resetStats}
			class="px-4 py-2 bg-surface-500 hover:bg-surface-600 text-white rounded-lg transition-colors"
		>
			Reset Stats
		</button>

		<div class="flex items-center gap-2">
			<label for="viewport-size" class="text-sm font-medium text-surface-700-200">Viewport:</label>
			<select
				id="viewport-size"
				bind:value={viewportSize}
				disabled={isBenchmarking}
				class="px-3 py-2 border border-surface-300-600 bg-surface-100-800 text-surface-900-50 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
			>
				<option value="720p">1280x720 (HD)</option>
				<option value="1080p">1920x1080 (FHD)</option>
				<option value="1440p">2560x1440 (QHD)</option>
			</select>
		</div>

		{#if isBenchmarking}
			<span class="text-sm text-surface-500-400 font-mono">
				{frameCount} frames
			</span>
		{/if}
	</div>

	{#if initError}
		<div class="bg-error-500/10 border border-error-500/30 rounded-lg p-4 text-error-500">
			<p class="text-sm font-medium">Initialization Error</p>
			<p class="text-sm mt-1">{initError}</p>
		</div>
	{/if}

	<!-- Key Metrics Grid -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
		<!-- FPS -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">FPS</div>
			<div class="text-3xl font-bold {getFpsColor(metrics.fps)}">
				{metrics.fps > 0 ? metrics.fps.toFixed(1) : '—'}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">Target: 30 fps</div>
		</div>

		<!-- Frame Time -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Frame Time</div>
			<div class="text-3xl font-bold {getFrameTimeColor(metrics.frameTimeMs)}">
				{metrics.frameTimeMs > 0 ? metrics.frameTimeMs.toFixed(2) : '—'}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">Target: &lt;33ms</div>
		</div>

		<!-- Total Pixels -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Total Pixels</div>
			<div class="text-3xl font-bold text-primary-500">
				{metrics.totalPixels > 0 ? metrics.totalPixels.toLocaleString() : '—'}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">{testWidth > 0 ? `${testWidth}x${testHeight}` : 'Per frame'}</div>
		</div>

		<!-- Adjusted Pixels -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Adjusted Pixels</div>
			<div class="text-3xl font-bold {metrics.adjustedPixels > 0 ? 'text-warning-500' : 'text-success-500'}">
				{metrics.adjustedPixels > 0 ? metrics.adjustedPixels.toLocaleString() : '0'}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">WCAG corrections</div>
		</div>

		<!-- Backend -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Backend</div>
			<div class="text-xl font-bold {getBackendColor(metrics.backend)} truncate" title={getBackendLabel(metrics.backend)}>
				{getBackendLabel(metrics.backend)}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">
				{metrics.mpixPerSec > 0 ? `${metrics.mpixPerSec.toFixed(1)} Mpix/s` : '—'}
			</div>
		</div>
	</div>

	<!-- Pipeline Breakdown -->
	{#if metrics.pipeline.length > 0}
		<div class="bg-surface-50-900 p-6 rounded-lg border border-surface-200-700 shadow-sm">
			<h3 class="text-lg font-semibold text-surface-900-50 mb-4">Pipeline Breakdown</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-surface-200-700">
							<th class="text-left py-2 px-4 font-medium text-surface-700-200">Stage</th>
							<th class="text-right py-2 px-4 font-medium text-surface-700-200">Time (ms)</th>
							<th class="text-right py-2 px-4 font-medium text-surface-700-200">% of Frame</th>
							<th class="py-2 px-4 font-medium text-surface-700-200">Distribution</th>
						</tr>
					</thead>
					<tbody>
						{#each metrics.pipeline as stage}
							<tr class="border-b border-surface-100-800 hover:bg-surface-100-800 text-surface-800-100">
								<td class="py-2 px-4">{stage.name}</td>
								<td class="text-right py-2 px-4 font-mono">{stage.timeMs.toFixed(2)}</td>
								<td class="text-right py-2 px-4 font-mono">{stage.percentage.toFixed(1)}%</td>
								<td class="py-2 px-4">
									<div class="w-full bg-surface-200-700 rounded-full h-2">
										<div
											class="bg-primary-500 h-2 rounded-full"
											style="width: {stage.percentage}%"
										></div>
									</div>
								</td>
							</tr>
						{/each}
						<tr class="font-semibold bg-surface-100-800 text-surface-900-50">
							<td class="py-2 px-4">Total</td>
							<td class="text-right py-2 px-4 font-mono">
								{metrics.pipeline.reduce((sum, s) => sum + s.timeMs, 0).toFixed(2)}
							</td>
							<td class="text-right py-2 px-4 font-mono">100.0%</td>
							<td class="py-2 px-4"></td>
						</tr>
					</tbody>
				</table>
			</div>
			<p class="text-xs text-surface-500-400 mt-3">
				The Futhark pipeline executes all 6 passes (grayscale, ESDT X/Y, glyph extraction, background sampling, contrast adjustment) as a single GPU dispatch. Per-pass timing requires a new Futhark entry point.
			</p>
		</div>
	{/if}

	<!-- Status Info -->
	{#if !isBenchmarking && metrics.fps === 0 && !initError}
		<div class="bg-primary-500/10 border border-primary-500/30 rounded-lg p-4 text-surface-700-200">
			<p class="text-sm">
				Click "Start Benchmark" to run the real ESDT contrast enhancement pipeline on a synthetic test image.
				Metrics are measured with <code class="font-mono text-xs">performance.now()</code> around actual Futhark pipeline calls.
			</p>
		</div>
	{/if}
</div>
