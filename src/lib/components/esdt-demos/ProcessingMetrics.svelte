<script lang="ts">
	/**
	 * ProcessingMetrics - Real-time metrics from WASM SIMD pipeline
	 *
	 * Displays actual processing statistics from the compositor,
	 * NOT simulated values. All data comes from the real pipeline.
	 */

	import Icon from '@iconify/svelte';
	import { pixelwiseStore } from '$lib/stores/pixelwiseStore.svelte';

	// Props for external metrics (from compositor)
	interface Props {
		glyphPixelCount?: number;
		violationCount?: number;
		frameTimeMs?: number;
		isProcessing?: boolean;
	}

	let {
		glyphPixelCount = 0,
		violationCount = 0,
		frameTimeMs = 0,
		isProcessing = false
	}: Props = $props();

	// Derived from store
	let targetContrast = $derived(pixelwiseStore.targetContrast);
	let wcagLevel = $derived(pixelwiseStore.wcagLevel);
	let wasmReady = $derived(pixelwiseStore.wasmReady);

	// Calculate FPS from frame time
	let fps = $derived(frameTimeMs > 0 ? Math.round(1000 / frameTimeMs) : 0);

	// Violation percentage
	let violationPercentage = $derived(
		glyphPixelCount > 0 ? ((violationCount / glyphPixelCount) * 100).toFixed(1) : '0.0'
	);
</script>

<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 overflow-hidden">
	<!-- Header -->
	<div class="px-4 py-3 border-b border-surface-300-600 bg-surface-100-800">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:activity" width={16} />
				Real-Time Pipeline Metrics
			</h3>
			<div class="flex items-center gap-2">
				{#if isProcessing}
					<span class="w-2 h-2 bg-success-500 rounded-full animate-pulse"></span>
					<span class="text-xs text-success-500">Processing</span>
				{:else}
					<span class="w-2 h-2 bg-surface-400 rounded-full"></span>
					<span class="text-xs text-surface-500-400">Idle</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Metrics Grid -->
	<div class="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
		<!-- Glyph Pixels -->
		<div class="text-center">
			<div class="text-2xl font-mono font-bold text-surface-900-50">
				{glyphPixelCount.toLocaleString()}
			</div>
			<div class="text-xs text-surface-500-400 uppercase tracking-wide">Glyph Pixels</div>
		</div>

		<!-- Violations -->
		<div class="text-center">
			<div class="text-2xl font-mono font-bold text-warning-500">
				{violationCount.toLocaleString()}
			</div>
			<div class="text-xs text-surface-500-400 uppercase tracking-wide">
				Violations ({violationPercentage}%)
			</div>
		</div>

		<!-- Frame Time -->
		<div class="text-center">
			<div class="text-2xl font-mono font-bold text-surface-900-50">
				{frameTimeMs.toFixed(1)}<span class="text-sm">ms</span>
			</div>
			<div class="text-xs text-surface-500-400 uppercase tracking-wide">{fps} FPS</div>
		</div>

		<!-- WCAG Target -->
		<div class="text-center">
			<div class="text-2xl font-mono font-bold text-primary-500">
				{targetContrast.toFixed(1)}<span class="text-sm">:1</span>
			</div>
			<div class="text-xs text-surface-500-400 uppercase tracking-wide">WCAG {wcagLevel}</div>
		</div>
	</div>

	<!-- Pipeline Status -->
	<div class="px-4 py-3 border-t border-surface-300-600 bg-surface-100-800">
		<div class="flex items-center justify-between text-xs">
			<div class="flex items-center gap-4">
				<span class="flex items-center gap-1">
					{#if wasmReady}
						<Icon icon="lucide:check" class="text-success-500" width={12} />
						<span class="text-success-500">Futhark WASM</span>
					{:else}
						<Icon icon="lucide:x" class="text-error-500" width={12} />
						<span class="text-error-500">WASM Unavailable</span>
					{/if}
				</span>
				<span class="text-surface-500-400">|</span>
				<span class="font-mono text-surface-600-300">compute_esdt_2d()</span>
			</div>
			<span class="text-surface-500-400">Multicore parallel</span>
		</div>
	</div>
</div>
