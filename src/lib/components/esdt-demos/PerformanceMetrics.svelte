<script lang="ts">
	interface PipelineStage {
		name: string;
		timeMs: number;
		percentage: number;
	}

	interface PerformanceData {
		fps: number;
		frameTimeMs: number;
		glyphPixels: number;
		violations: number;
		cacheHitRate: number;
		pipeline: PipelineStage[];
	}

	let viewportSize = $state<'720p' | '1080p' | '1440p'>('1080p');
	let isBenchmarking = $state(false);
	let intervalId: number | null = null;

	const viewportSizes = {
		'720p': { width: 1280, height: 720, pixels: 921600 },
		'1080p': { width: 1920, height: 1080, pixels: 2073600 },
		'1440p': { width: 2560, height: 1440, pixels: 3686400 }
	};

	let metrics = $state<PerformanceData>({
		fps: 0,
		frameTimeMs: 0,
		glyphPixels: 0,
		violations: 0,
		cacheHitRate: 0,
		pipeline: []
	});

	function generateMockMetrics(): PerformanceData {
		const viewport = viewportSizes[viewportSize];
		const baseFrameTime = 18 + Math.random() * 6; // 18-24ms for 30fps target

		// Simulate pipeline stages with realistic timings
		const grayscaleGradient = 2.1 + Math.random() * 0.5;
		const esdtXPass = 4.2 + Math.random() * 0.8;
		const esdtYPass = 4.0 + Math.random() * 0.8;
		const pixelExtraction = 1.8 + Math.random() * 0.4;
		const backgroundSampling = 2.3 + Math.random() * 0.6;
		const contrastAnalysis = 1.5 + Math.random() * 0.4;
		const colorAdjustment = 1.2 + Math.random() * 0.3;
		const render = 1.5 + Math.random() * 0.4;

		const totalTime =
			grayscaleGradient +
			esdtXPass +
			esdtYPass +
			pixelExtraction +
			backgroundSampling +
			contrastAnalysis +
			colorAdjustment +
			render;

		const pipeline: PipelineStage[] = [
			{
				name: 'Grayscale + Gradient',
				timeMs: grayscaleGradient,
				percentage: (grayscaleGradient / totalTime) * 100
			},
			{
				name: 'ESDT X-Pass',
				timeMs: esdtXPass,
				percentage: (esdtXPass / totalTime) * 100
			},
			{
				name: 'ESDT Y-Pass',
				timeMs: esdtYPass,
				percentage: (esdtYPass / totalTime) * 100
			},
			{
				name: 'Pixel Extraction',
				timeMs: pixelExtraction,
				percentage: (pixelExtraction / totalTime) * 100
			},
			{
				name: 'Background Sampling',
				timeMs: backgroundSampling,
				percentage: (backgroundSampling / totalTime) * 100
			},
			{
				name: 'Contrast Analysis',
				timeMs: contrastAnalysis,
				percentage: (contrastAnalysis / totalTime) * 100
			},
			{
				name: 'Color Adjustment',
				timeMs: colorAdjustment,
				percentage: (colorAdjustment / totalTime) * 100
			},
			{
				name: 'Render',
				timeMs: render,
				percentage: (render / totalTime) * 100
			}
		];

		// Simulate glyph pixels (roughly 2-5% of viewport)
		const glyphPixels = Math.floor(viewport.pixels * (0.02 + Math.random() * 0.03));

		return {
			fps: 1000 / baseFrameTime,
			frameTimeMs: baseFrameTime,
			glyphPixels,
			violations: Math.floor(Math.random() * 5), // 0-4 violations
			cacheHitRate: 92 + Math.random() * 6, // 92-98% cache hit rate
			pipeline
		};
	}

	function startBenchmark() {
		if (isBenchmarking) return;

		isBenchmarking = true;
		intervalId = setInterval(() => {
			metrics = generateMockMetrics();
		}, 100) as unknown as number; // Update every 100ms for smooth animation
	}

	function stopBenchmark() {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
		isBenchmarking = false;
	}

	function resetStats() {
		stopBenchmark();
		metrics = {
			fps: 0,
			frameTimeMs: 0,
			glyphPixels: 0,
			violations: 0,
			cacheHitRate: 0,
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

	$effect(() => {
		return () => {
			if (intervalId !== null) {
				clearInterval(intervalId);
			}
		};
	});
</script>

<div class="space-y-6">
	<!-- Controls -->
	<div class="flex flex-wrap gap-4 items-center">
		<button
			onclick={() => (isBenchmarking ? stopBenchmark() : startBenchmark())}
			class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
		>
			{isBenchmarking ? 'Stop Benchmark' : 'Start Benchmark'}
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
				class="px-3 py-2 border border-surface-300-600 bg-surface-100-800 text-surface-900-50 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
			>
				<option value="720p">1280x720 (HD)</option>
				<option value="1080p">1920x1080 (FHD)</option>
				<option value="1440p">2560x1440 (QHD)</option>
			</select>
		</div>
	</div>

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

		<!-- Glyph Pixels -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Glyph Pixels</div>
			<div class="text-3xl font-bold text-primary-500">
				{metrics.glyphPixels > 0 ? metrics.glyphPixels.toLocaleString() : '—'}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">Per frame</div>
		</div>

		<!-- Violations -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Violations</div>
			<div class="text-3xl font-bold {metrics.violations > 0 ? 'text-warning-500' : 'text-success-500'}">
				{metrics.violations > 0 ? metrics.violations : '0'}
			</div>
			<div class="text-xs text-surface-500-400 mt-1">WCAG failures</div>
		</div>

		<!-- Cache Hit Rate -->
		<div class="bg-surface-50-900 p-4 rounded-lg border border-surface-200-700 shadow-sm">
			<div class="text-sm text-surface-600-300 mb-1">Cache Hit Rate</div>
			<div class="text-3xl font-bold text-secondary-500">
				{metrics.cacheHitRate > 0 ? metrics.cacheHitRate.toFixed(1) : '—'}%
			</div>
			<div class="text-xs text-surface-500-400 mt-1">Background cache</div>
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
		</div>
	{/if}

	<!-- Status Info -->
	{#if !isBenchmarking && metrics.fps === 0}
		<div class="bg-primary-500/10 border border-primary-500/30 rounded-lg p-4 text-surface-700-200">
			<p class="text-sm">
				Click "Start Benchmark" to begin simulated performance monitoring. This demo uses mock data
				to demonstrate the metrics interface.
			</p>
		</div>
	{/if}
</div>
