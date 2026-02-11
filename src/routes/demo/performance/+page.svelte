<script lang="ts">
	import PerformanceMetrics from '$lib/components/esdt-demos/PerformanceMetrics.svelte';
</script>

<svelte:head>
	<title>Performance Metrics - Pixelwise ESDT Demo</title>
	<meta
		name="description"
		content="Real-time performance monitoring for the Pixelwise ESDT text rendering pipeline"
	/>
</svelte:head>

<div class="min-h-screen bg-surface-50-900">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		<!-- Header -->
		<div class="mb-8">
			<h1 class="text-4xl font-bold text-surface-900-50 mb-2">Performance Metrics</h1>
			<p class="text-lg text-surface-600-300">
				Real-time monitoring of the Extended Signed Distance Transform (ESDT) text rendering
				pipeline
			</p>
		</div>

		<!-- Status Banner -->
		<div class="mb-8 bg-success-500/10 border border-success-500/30 rounded-lg p-4">
			<div class="flex items-start gap-3">
				<svg class="w-5 h-5 text-success-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<div class="text-sm text-surface-700-200">
					<strong class="text-success-500">Live Instrumentation:</strong> This demo runs the real ESDT contrast enhancement pipeline on a synthetic test image.
					Timing is measured with <code class="font-mono text-xs">performance.now()</code> around actual Futhark pipeline calls.
				</div>
			</div>
		</div>

		<!-- Overview -->
		<div class="bg-surface-50-900 rounded-lg border border-surface-200-700 shadow-sm p-6 mb-8">
			<h2 class="text-xl font-semibold text-surface-900-50 mb-4">About This Demo</h2>
			<div class="prose prose-sm max-w-none text-surface-700-200">
				<p>
					This performance dashboard monitors the complete ESDT text rendering pipeline, from
					initial glyph detection through final color correction. The pipeline is designed to
					maintain 30fps (33ms per frame) while processing thousands of glyph pixels in real-time.
				</p>

				<h3 class="text-lg font-semibold text-surface-900-50 mt-4 mb-2">Pipeline Stages</h3>
				<ul class="space-y-2">
					<li>
						<strong class="text-surface-800-100">Grayscale + Gradient:</strong> Convert input to grayscale and compute gradients
					</li>
					<li>
						<strong class="text-surface-800-100">ESDT X-Pass:</strong> Horizontal distance transform pass for glyph detection
					</li>
					<li>
						<strong class="text-surface-800-100">ESDT Y-Pass:</strong> Vertical distance transform pass for glyph detection
					</li>
					<li>
						<strong class="text-surface-800-100">Pixel Extraction:</strong> Extract detected glyph pixel coordinates
					</li>
					<li>
						<strong class="text-surface-800-100">Background Sampling:</strong> Sample background colors with caching
					</li>
					<li>
						<strong class="text-surface-800-100">Contrast Analysis:</strong> Compute WCAG contrast ratios and detect violations
					</li>
					<li>
						<strong class="text-surface-800-100">Color Adjustment:</strong> Apply OKLCH corrections to meet WCAG standards
					</li>
					<li><strong class="text-surface-800-100">Render:</strong> Composite final output to display</li>
				</ul>

				<h3 class="text-lg font-semibold text-surface-900-50 mt-4 mb-2">Performance Targets</h3>
				<ul class="space-y-1">
					<li><strong class="text-surface-800-100">FPS:</strong> 30+ frames per second (smooth animation)</li>
					<li><strong class="text-surface-800-100">Frame Time:</strong> &lt;33ms total pipeline execution</li>
					<li><strong class="text-surface-800-100">Throughput:</strong> &gt;50 Mpix/s on WebGPU, &gt;5 Mpix/s on WASM</li>
					<li><strong class="text-surface-800-100">Adjusted Pixels:</strong> Pixels corrected per frame to meet WCAG contrast ratio</li>
				</ul>
			</div>
		</div>

		<!-- Performance Metrics Component -->
		<PerformanceMetrics />

		<!-- Technical Details -->
		<div class="mt-8 bg-primary-500/10 border border-primary-500/30 rounded-lg p-6">
			<h3 class="text-lg font-semibold text-primary-500 mb-2">Implementation Notes</h3>
			<div class="text-sm text-surface-700-200 space-y-2">
				<p>
					<strong class="text-primary-500">How it works:</strong> The benchmark initializes a
					<code class="font-mono text-xs">ComputeDispatcher</code>, generates a synthetic test image at the
					selected resolution, and runs the full 6-pass ESDT pipeline in a
					<code class="font-mono text-xs">requestAnimationFrame</code> loop.
				</p>
				<ul class="list-disc list-inside ml-4 space-y-1">
					<li>Futhark WebGPU (preferred) or Futhark WASM multicore, with JS fallback</li>
					<li>Pipeline timing via <code class="font-mono text-xs">performance.now()</code> around Futhark calls + GPU sync</li>
					<li>Data-transfer overhead measured separately (TypedArray copies, pixel counting)</li>
					<li>FPS derived from <code class="font-mono text-xs">PipelineMetrics</code> timestamp history (30-frame window)</li>
					<li>Per-pass breakdown requires a dedicated Futhark entry point (not yet exposed)</li>
				</ul>
			</div>
		</div>

		<!-- Navigation -->
		<div class="mt-8 flex gap-4">
			<a
				href="/"
				class="px-4 py-2 bg-surface-500 hover:bg-surface-600 text-white rounded-lg transition-colors"
			>
				Back to Home
			</a>
			<a
				href="/demo/contrast-analysis"
				class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
			>
				View Contrast Analysis
			</a>
		</div>
	</div>
</div>
