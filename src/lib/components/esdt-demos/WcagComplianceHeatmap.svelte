<script lang="ts">
	/**
	 * WcagComplianceHeatmap - Pixel-level WCAG compliance visualization
	 *
	 * Renders text to a canvas, processes through the Futhark WebGPU
	 * debug_wcag_compliance entry point, and displays a heatmap where:
	 *   - Green = contrast meets target ratio
	 *   - Red = contrast fails target ratio
	 *   - Transparent = non-glyph pixels
	 *
	 * Requires Futhark WebGPU backend; shows fallback message if unavailable.
	 *
	 * @see futhark/pipeline.fut - debug_wcag_compliance entry point
	 */

	import Icon from '@iconify/svelte';
	import { onMount, onDestroy } from 'svelte';
	import { createComputeDispatcher, type ComputeDispatcher } from '$lib/core/ComputeDispatcher';

	// Props
	interface Props {
		initialText?: string;
		showTiming?: boolean;
	}

	let { initialText = 'Sample', showTiming = true }: Props = $props();

	let dispatcher: ComputeDispatcher | null = null;
	let available = $state(false);

	// Canvas refs
	let textCanvas: HTMLCanvasElement | null = null;
	let heatmapCanvas: HTMLCanvasElement | null = null;

	// State
	let inputText = $state(initialText);
	let targetContrast = $state(7.0);
	let processingTimeMs = $state(0);
	let pixelCount = $state(0);

	const canvasWidth = 300;
	const canvasHeight = 120;

	onMount(async () => {
		dispatcher = createComputeDispatcher();
		try {
			await dispatcher.initialize();
			available = dispatcher.hasFutharkWebGPU;
			if (available) {
				renderHeatmap();
			}
		} catch {
			available = false;
		}
	});

	onDestroy(() => {
		if (dispatcher) {
			dispatcher.destroy();
			dispatcher = null;
		}
	});

	function renderTextToCanvas(): Uint8ClampedArray | null {
		if (!textCanvas) return null;
		const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;

		ctx.fillStyle = '#e8e8e8';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);
		ctx.fillStyle = '#606060'; // Low-contrast gray text
		ctx.font = 'bold 56px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(inputText, canvasWidth / 2, canvasHeight / 2);

		return ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
	}

	async function renderHeatmap() {
		if (!dispatcher || !available || !heatmapCanvas) return;

		const rgbaData = renderTextToCanvas();
		if (!rgbaData) return;

		try {
			const startTime = performance.now();

			const result = await dispatcher.debugWcagCompliance(
				rgbaData, canvasWidth, canvasHeight, targetContrast, 3.0, 5.0
			);

			const elapsed = performance.now() - startTime;
			processingTimeMs = elapsed;
			pixelCount = canvasWidth * canvasHeight;

			const ctx = heatmapCanvas.getContext('2d');
			if (!ctx) return;

			const imageData = new ImageData(
				new Uint8ClampedArray(result.buffer, result.byteOffset, result.byteLength),
				canvasWidth,
				canvasHeight
			);
			ctx.clearRect(0, 0, canvasWidth, canvasHeight);
			ctx.putImageData(imageData, 0, 0);
		} catch (error: unknown) {
			console.error('[WcagHeatmap] Futhark visualization failed:', error);
		}
	}

	// Recompute when inputs change
	$effect(() => {
		inputText;
		targetContrast;
		if (available) {
			renderHeatmap();
		}
	});
</script>

<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 overflow-hidden">
	<div class="px-4 py-3 border-b border-surface-300-600 bg-surface-100-800">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:scan-eye" width={16} />
				Pixel-Level WCAG Compliance Heatmap
				<span class="text-xs font-mono text-primary-500">(Futhark WebGPU)</span>
			</h3>
			{#if available}
				<span class="flex items-center gap-1 text-xs text-success-500">
					<Icon icon="lucide:check" width={12} />
					Futhark WebGPU
				</span>
			{:else}
				<span class="flex items-center gap-1 text-xs text-surface-500-400">
					Requires WebGPU
				</span>
			{/if}
		</div>
	</div>

	{#if available}
		<div class="p-4 space-y-4">
			<!-- Controls -->
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-2">
					<label class="text-sm text-surface-700-200 w-20">Text</label>
					<input
						type="text"
						bind:value={inputText}
						class="px-3 py-1.5 rounded bg-surface-100-800 border border-surface-300-600 text-surface-900-50 font-mono text-sm w-32"
					/>
				</div>
				<div class="flex items-center gap-2">
					<label class="text-sm text-surface-700-200">Target CR:</label>
					<select
						bind:value={targetContrast}
						class="px-2 py-1.5 rounded bg-surface-100-800 border border-surface-300-600 text-surface-900-50 text-sm"
					>
						<option value={3.0}>3.0:1 (AA Large)</option>
						<option value={4.5}>4.5:1 (AA)</option>
						<option value={7.0}>7.0:1 (AAA)</option>
					</select>
				</div>
			</div>

			<!-- Canvases -->
			<div class="flex gap-4">
				<div class="space-y-1">
					<div class="text-xs text-surface-500-400">Input (low contrast)</div>
					<div class="relative bg-surface-100-800 rounded overflow-hidden" style="width: {canvasWidth}px; height: {canvasHeight}px;">
						<canvas
							bind:this={textCanvas}
							width={canvasWidth}
							height={canvasHeight}
						></canvas>
					</div>
				</div>
				<div class="space-y-1">
					<div class="text-xs text-surface-500-400">Compliance overlay</div>
					<div class="relative bg-surface-100-800 rounded overflow-hidden" style="width: {canvasWidth}px; height: {canvasHeight}px;">
						<canvas
							bind:this={heatmapCanvas}
							width={canvasWidth}
							height={canvasHeight}
						></canvas>
					</div>
				</div>
			</div>

			<!-- Legend -->
			<div class="flex items-center gap-4 text-xs text-surface-500-400">
				<span class="flex items-center gap-1">
					<span class="w-3 h-3 rounded bg-green-500"></span>
					Passing
				</span>
				<span class="flex items-center gap-1">
					<span class="w-3 h-3 rounded bg-red-500"></span>
					Failing
				</span>
				<span class="flex items-center gap-1">
					<span class="w-3 h-3 rounded bg-surface-300-600"></span>
					Non-glyph (transparent)
				</span>
			</div>
		</div>

		{#if showTiming}
			<div class="px-4 py-3 border-t border-surface-300-600 bg-surface-100-800">
				<div class="flex items-center gap-4 text-xs">
					<span class="text-surface-500-400">
						Processing: <span class="font-mono text-surface-900-50">{processingTimeMs.toFixed(2)}</span> ms
					</span>
					<span class="text-surface-500-400">|</span>
					<span class="text-surface-500-400">
						Pixels: <span class="font-mono text-surface-900-50">{pixelCount.toLocaleString()}</span>
					</span>
				</div>
			</div>
		{/if}
	{:else}
		<div class="p-6 text-center text-sm text-surface-500-400">
			<Icon icon="lucide:info" width={20} class="mx-auto mb-2 text-surface-400" />
			<p>Pixel-level WCAG compliance heatmap requires Futhark WebGPU.</p>
			<p class="text-xs mt-1">Run <code class="font-mono bg-surface-200-700 px-1 rounded">just futhark-webgpu-compile</code> to enable.</p>
		</div>
	{/if}
</div>
