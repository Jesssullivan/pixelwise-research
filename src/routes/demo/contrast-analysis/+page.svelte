<script lang="ts">
	/**
	 * Contrast Analysis Demo Page
	 *
	 * Uses TypeScript implementation of WCAG 2.1 contrast calculation.
	 * The formula matches futhark/wcag.fut for consistency.
	 *
	 * Includes a pixel-level WCAG compliance heatmap via Futhark WebGPU
	 * when available (green = passing, red = failing).
	 *
	 * @see futhark/wcag.fut - WCAG contrast calculation reference
	 */

	import DemoHeader from '$lib/components/demo-layout/DemoHeader.svelte';
	import ContrastAnalysisWidget from '$lib/components/esdt-demos/ContrastAnalysisWidget.svelte';
	import WcagComplianceHeatmap from '$lib/components/esdt-demos/WcagComplianceHeatmap.svelte';
	import Icon from '@iconify/svelte';
</script>

<DemoHeader
	title="WCAG Contrast Analysis"
	description="WCAG 2.1 contrast ratio calculation with real-time visualization"
/>

<div class="p-8 max-w-4xl mx-auto space-y-8">
	<!-- Technical Note -->
	<div class="bg-primary-500/10 border border-primary-500/30 rounded-lg p-4">
		<div class="flex items-start gap-3">
			<Icon icon="lucide:info" class="text-primary-500 mt-0.5" width={20} />
			<div>
				<h3 class="font-semibold text-surface-900-50">WCAG 2.1 Implementation</h3>
				<p class="text-sm text-surface-700-200 mt-1">
					This widget implements the WCAG 2.1 contrast formula with proper sRGB gamma correction
					(threshold <code class="font-mono bg-surface-200-700 px-1 rounded">0.03928</code>, gamma <code class="font-mono bg-surface-200-700 px-1 rounded">2.4</code>).
					The formula matches <code class="font-mono bg-surface-200-700 px-1 rounded">futhark/wcag.fut</code> for consistency with the full pipeline.
				</p>
			</div>
		</div>
	</div>

	<!-- Main Widget -->
	<ContrastAnalysisWidget showTiming={true} />

	<!-- Pixel-Level WCAG Compliance Heatmap -->
	<WcagComplianceHeatmap />

	<!-- WCAG Reference -->
	<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 p-6">
		<h3 class="font-semibold text-surface-900-50 mb-4 flex items-center gap-2">
			<Icon icon="lucide:book-open" width={18} />
			WCAG 2.1 Contrast Requirements
		</h3>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
			<div class="bg-surface-100-800 rounded p-4">
				<div class="flex items-center gap-2 mb-2">
					<span class="px-2 py-0.5 bg-primary-500 text-white text-xs font-semibold rounded">AA</span>
					<span class="font-semibold text-surface-900-50">Level AA</span>
				</div>
				<ul class="space-y-1 text-surface-700-200">
					<li>Normal text: <span class="font-mono text-primary-500">4.5:1</span></li>
					<li>Large text: <span class="font-mono text-primary-500">3.0:1</span></li>
					<li>UI components: <span class="font-mono text-primary-500">3.0:1</span></li>
				</ul>
			</div>
			<div class="bg-surface-100-800 rounded p-4">
				<div class="flex items-center gap-2 mb-2">
					<span class="px-2 py-0.5 bg-success-500 text-white text-xs font-semibold rounded">AAA</span>
					<span class="font-semibold text-surface-900-50">Level AAA</span>
				</div>
				<ul class="space-y-1 text-surface-700-200">
					<li>Normal text: <span class="font-mono text-primary-500">7.0:1</span></li>
					<li>Large text: <span class="font-mono text-primary-500">4.5:1</span></li>
				</ul>
			</div>
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
