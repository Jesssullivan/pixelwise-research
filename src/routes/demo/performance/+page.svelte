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
		<div class="mb-8 bg-warning-500/10 border border-warning-500/30 rounded-lg p-4">
			<div class="flex items-start gap-3">
				<svg class="w-5 h-5 text-warning-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<div class="text-sm text-surface-700-200">
					<strong class="text-warning-500">Simulated Data:</strong> This demo currently displays simulated performance metrics. Real pipeline profiling requires WebGPU integration.
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
					<li>
						<strong class="text-surface-800-100">Cache Hit Rate:</strong> &gt;90% (reduces redundant background sampling)
					</li>
					<li><strong class="text-surface-800-100">Violations:</strong> Minimize WCAG contrast failures detected per frame</li>
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
					<strong class="text-primary-500">Note:</strong> This demo currently uses simulated performance data. The real pipeline
					will integrate with:
				</p>
				<ul class="list-disc list-inside ml-4 space-y-1">
					<li>Futhark WASM multicore for parallel ESDT computation</li>
					<li>WebGL2 for overlay rendering</li>
					<li>LRU background color cache to minimize DOM sampling</li>
					<li>RequestAnimationFrame timing for accurate FPS measurement</li>
					<li>Performance.now() for high-resolution stage profiling</li>
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
