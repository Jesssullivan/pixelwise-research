<script lang="ts">
	/**
	 * Gradient Direction Demo Page
	 *
	 * Uses the REAL Futhark WASM compute_esdt_2d() function.
	 * This is the verified ESDT algorithm with verified tests.
	 *
	 * @see futhark/esdt.fut - compute_esdt_2d() implementation
	 */

	import DemoHeader from '$lib/components/demo-layout/DemoHeader.svelte';
	import GradientDirectionVisualizer from '$lib/components/esdt-demos/GradientDirectionVisualizer.svelte';
	import Icon from '@iconify/svelte';
</script>

<DemoHeader
	title="ESDT Gradient Direction"
	description="Real Extended Signed Distance Transform visualization using Futhark WASM"
/>

<div class="p-8 max-w-4xl mx-auto space-y-8">
	<!-- Technical Note -->
	<div class="bg-success-500/10 border border-success-500/30 rounded-lg p-4">
		<div class="flex items-start gap-3">
			<Icon icon="lucide:check-circle" class="text-success-500 mt-0.5" width={20} />
			<div>
				<h3 class="font-semibold text-surface-900-50">Real Futhark WASM ESDT Algorithm</h3>
				<p class="text-sm text-surface-700-200 mt-1">
					This widget uses <code class="font-mono bg-surface-200-700 px-1 rounded">compute_esdt_2d()</code>
					from <code class="font-mono bg-surface-200-700 px-1 rounded">futhark/esdt.fut</code>,
					compiled to WASM with multicore support. Falls back to JS implementation if WASM fails to load.
				</p>
			</div>
		</div>
	</div>

	<!-- Note about parallelism -->
	<div class="bg-surface-100-800 border border-surface-300-600 rounded-lg p-4">
		<div class="flex items-start gap-3">
			<Icon icon="lucide:info" class="text-primary-500 mt-0.5" width={20} />
			<div>
				<h3 class="font-semibold text-surface-900-50">ESDT Parallelism Model</h3>
				<p class="text-sm text-surface-700-200 mt-1">
					The Extended Signed Distance Transform uses separable 2D passes (X-pass then Y-pass)
					that are inherently sequential within each row/column - each pixel depends on its neighbors in scan order.
					However, all rows (X-pass) and columns (Y-pass) can be processed in parallel. Futhark exploits this
					via Web Workers (pthreads), while WebGPU dispatches one workgroup per row/column.
				</p>
			</div>
		</div>
	</div>

	<!-- Main Widget -->
	<GradientDirectionVisualizer initialText="Aa" showTiming={true} />

	<!-- Algorithm Explanation -->
	<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 p-6">
		<h3 class="font-semibold text-surface-900-50 mb-4 flex items-center gap-2">
			<Icon icon="lucide:git-branch" width={18} />
			How ESDT Works
		</h3>
		<div class="space-y-4 text-sm text-surface-700-200">
			<p>
				The Extended Signed Distance Transform computes, for each pixel, a vector pointing
				to the nearest edge of the shape. This is used in the pixelwise pipeline to:
			</p>
			<ul class="list-disc list-inside space-y-1 ml-4">
				<li>Identify glyph edge pixels (where contrast matters most)</li>
				<li>Weight the kernel density estimation</li>
				<li>Determine coverage values for anti-aliased edges</li>
			</ul>
			<p class="mt-4">
				The algorithm processes in two passes:
			</p>
			<ol class="list-decimal list-inside space-y-2 ml-4">
				<li><strong>X-pass:</strong> Propagate distance information horizontally</li>
				<li><strong>Y-pass:</strong> Propagate distance information vertically</li>
			</ol>
			<p class="mt-4 text-xs text-surface-500-400">
				Optional relaxation pass smooths gradients for anti-aliased rendering.
			</p>
		</div>
	</div>

	<!-- Back to Home -->
	<div class="flex justify-center">
		<a
			href="/"
			class="btn preset-tonal-surface inline-flex items-center gap-2"
		>
			<Icon icon="lucide:arrow-left" width={16} />
			Back to Home
		</a>
	</div>
</div>
