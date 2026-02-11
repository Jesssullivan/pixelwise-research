<script lang="ts">
	/**
	 * GradientDirectionVisualizer - ESDT Gradient Direction Visualization
	 *
	 * Uses the ComputeDispatcher to run ESDT computation, with automatic
	 * backend selection:
	 *   1. Futhark WebGPU (GPU, via debug_esdt_flat entry point)
	 *   2. Futhark WASM (multicore CPU)
	 *   3. JS fallback (single-threaded)
	 *
	 * The ESDT algorithm uses 2D separable passes (X-pass + Y-pass)
	 * to compute distance and gradient vectors to the nearest edge.
	 *
	 * @see futhark/pipeline.fut - debug_esdt_flat() entry point
	 * @see futhark/esdt.fut - compute_esdt_2d() implementation
	 */

	import Icon from '@iconify/svelte';
	import { onMount, onDestroy } from 'svelte';
	import { createComputeDispatcher, type ComputeDispatcher } from '$lib/core/ComputeDispatcher';

	// Props
	interface Props {
		initialText?: string;
		showTiming?: boolean;
	}

	let { initialText = 'Aa', showTiming = true }: Props = $props();

	// Compute dispatcher (handles WebGPU -> WASM -> JS fallback)
	let dispatcher: ComputeDispatcher | null = $state(null);
	let dispatcherReady = $state(false);

	// Canvas refs
	let textCanvas = $state<HTMLCanvasElement | null>(null);
	let vectorCanvas = $state<HTMLCanvasElement | null>(null);

	// Visualization modes
	type VizMode = 'gradient-arrows' | 'distance-heatmap' | 'glyph-mask';
	const VIZ_MODES: { value: VizMode; label: string; requiresGPU: boolean }[] = [
		{ value: 'gradient-arrows', label: 'Gradient Arrows (JS)', requiresGPU: false },
		{ value: 'distance-heatmap', label: 'Distance Heatmap (Futhark)', requiresGPU: true },
		{ value: 'glyph-mask', label: 'Glyph Mask (Futhark)', requiresGPU: true },
	];

	// State
	let inputText = $state(initialText);
	let useRelaxation = $state(false);
	let arrowScale = $state(8);
	let showDistanceMap = $state(true);
	let vizMode = $state<VizMode>('gradient-arrows');

	// Metrics
	let processingTimeMs = $state(0);
	let pixelCount = $state(0);
	let canvasWidth = $state(200);
	let canvasHeight = $state(100);

	// Backend indicator
	let activeBackendLabel = $state('');

	// ESDT data (flat array: [delta_x, delta_y, ...])
	let esdtData: Float32Array | null = null;

	onMount(async () => {
		dispatcher = createComputeDispatcher();
		try {
			await dispatcher.initialize();
			dispatcherReady = true;
			computeESDT();
		} catch (error: unknown) {
			console.warn('[GradientViz] Dispatcher initialization failed:', error);
			// Dispatcher still provides JS fallback even if GPU/WASM fail
			dispatcherReady = true;
			computeESDT();
		}
	});

	onDestroy(() => {
		if (dispatcher) {
			dispatcher.destroy();
			dispatcher = null;
		}
	});

	/**
	 * Render text to canvas and extract pixel data
	 *
	 * Returns both grayscale levels (for WASM/JS path) and raw RGBA
	 * pixels (for WebGPU path) to avoid redundant conversions.
	 */
	function renderTextToData(): {
		levels: Float32Array;
		rgbaData: Uint8ClampedArray;
		width: number;
		height: number;
	} | null {
		if (!textCanvas) return null;

		const ctx = textCanvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;

		// Clear canvas
		ctx.fillStyle = 'white';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		// Render text
		ctx.fillStyle = 'black';
		ctx.font = 'bold 64px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(inputText, canvasWidth / 2, canvasHeight / 2);

		// Extract pixel data
		const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
		const pixels = imageData.data;

		// Convert to grayscale levels [0.0-1.0] (needed for WASM/JS backends)
		const levels = new Float32Array(canvasWidth * canvasHeight);
		for (let i = 0; i < levels.length; i++) {
			const r = pixels[i * 4];
			const g = pixels[i * 4 + 1];
			const b = pixels[i * 4 + 2];
			// Standard luminance formula
			const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
			// Invert: black text = 1.0 (inside), white bg = 0.0 (outside)
			levels[i] = 1.0 - luminance;
		}

		return { levels, rgbaData: pixels, width: canvasWidth, height: canvasHeight };
	}

	/**
	 * Visualize ESDT gradient vectors on canvas
	 */
	function visualizeGradients() {
		if (!vectorCanvas || !esdtData) return;

		const ctx = vectorCanvas.getContext('2d');
		if (!ctx) return;

		// Clear
		ctx.clearRect(0, 0, canvasWidth, canvasHeight);

		// Draw distance map if enabled
		if (showDistanceMap) {
			const imageData = ctx.createImageData(canvasWidth, canvasHeight);
			const pixels = imageData.data;

			let maxDistance = 0;
			for (let i = 0; i < esdtData.length; i += 2) {
				const dx = esdtData[i];
				const dy = esdtData[i + 1];
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < 1e9) maxDistance = Math.max(maxDistance, dist);
			}

			for (let i = 0; i < pixelCount; i++) {
				const dx = esdtData[i * 2];
				const dy = esdtData[i * 2 + 1];
				const dist = Math.sqrt(dx * dx + dy * dy);
				const normalized = dist / (maxDistance || 1);

				// Color by distance: blue (near) to red (far)
				const r = Math.floor(normalized * 255);
				const b = Math.floor((1 - normalized) * 255);
				const g = Math.floor(Math.min(normalized, 1 - normalized) * 2 * 128);

				pixels[i * 4] = r;
				pixels[i * 4 + 1] = g;
				pixels[i * 4 + 2] = b;
				pixels[i * 4 + 3] = 128; // Semi-transparent
			}

			ctx.putImageData(imageData, 0, 0);
		}

		// Draw gradient arrows (sample every N pixels)
		const step = 8;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.lineWidth = 1;

		for (let y = step / 2; y < canvasHeight; y += step) {
			for (let x = step / 2; x < canvasWidth; x += step) {
				const i = y * canvasWidth + x;
				const dx = esdtData[i * 2];
				const dy = esdtData[i * 2 + 1];

				// Skip pixels with zero gradient (inside solid regions)
				if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;

				// Normalize and scale
				const mag = Math.sqrt(dx * dx + dy * dy);
				if (mag < 0.1) continue;

				const ndx = (dx / mag) * arrowScale;
				const ndy = (dy / mag) * arrowScale;

				// Draw arrow
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x + ndx, y + ndy);
				ctx.stroke();

				// Draw arrowhead
				const headSize = 2;
				const angle = Math.atan2(ndy, ndx);
				ctx.beginPath();
				ctx.moveTo(x + ndx, y + ndy);
				ctx.lineTo(
					x + ndx - headSize * Math.cos(angle - Math.PI / 6),
					y + ndy - headSize * Math.sin(angle - Math.PI / 6)
				);
				ctx.moveTo(x + ndx, y + ndy);
				ctx.lineTo(
					x + ndx - headSize * Math.cos(angle + Math.PI / 6),
					y + ndy - headSize * Math.sin(angle + Math.PI / 6)
				);
				ctx.stroke();
			}
		}
	}

	/**
	 * Render Futhark GPU visualization (distance heatmap or glyph mask)
	 */
	async function renderFutharkVisualization() {
		if (!dispatcher || !dispatcher.hasFutharkWebGPU || !vectorCanvas) return;

		const data = renderTextToData();
		if (!data) return;

		const ctx = vectorCanvas.getContext('2d');
		if (!ctx) return;

		try {
			const startTime = performance.now();

			let resultRgba: Uint8Array;
			if (vizMode === 'distance-heatmap') {
				resultRgba = await dispatcher.debugDistanceHeatmap(data.rgbaData, data.width, data.height, 100);
			} else {
				resultRgba = await dispatcher.debugGlyphMask(data.rgbaData, data.width, data.height, 100);
			}

			const elapsed = performance.now() - startTime;
			processingTimeMs = elapsed;
			pixelCount = data.width * data.height;

			// Render to canvas
			const clampedArr = new Uint8ClampedArray(resultRgba.length);
			clampedArr.set(resultRgba);
			const imageData = new ImageData(clampedArr, data.width, data.height);
			ctx.clearRect(0, 0, canvasWidth, canvasHeight);
			ctx.putImageData(imageData, 0, 0);

			activeBackendLabel = 'Futhark WebGPU';
			console.log(`[GradientViz] ${vizMode} (Futhark WebGPU): ${pixelCount} pixels in ${processingTimeMs.toFixed(2)}ms`);
		} catch (error: unknown) {
			console.error(`[GradientViz] Futhark ${vizMode} failed:`, error);
		}
	}

	/**
	 * Compute ESDT via ComputeDispatcher and visualize
	 */
	async function computeESDT() {
		if (!dispatcherReady || !dispatcher) return;

		const data = renderTextToData();
		if (!data) return;

		try {
			const startTime = performance.now();

			// Pass both levels (for WASM/JS) and rgbaData (for WebGPU)
			const result = await dispatcher.computeEsdt(
				data.levels,
				data.width,
				data.height,
				{ useRelaxation, maxDistance: 100 },
				data.rgbaData
			);

			const elapsed = performance.now() - startTime;

			esdtData = result.data;
			pixelCount = data.width * data.height;
			processingTimeMs = elapsed;

			// Update backend label from dispatcher state
			if (dispatcher.hasFutharkWebGPU) {
				activeBackendLabel = 'Futhark WebGPU';
			} else if (dispatcher.hasFuthark) {
				activeBackendLabel = 'Futhark WASM';
			} else {
				activeBackendLabel = 'JS fallback';
			}

			visualizeGradients();

			console.log(`[GradientViz] computeEsdt (${activeBackendLabel}): ${pixelCount} pixels in ${processingTimeMs.toFixed(2)}ms`);
		} catch (error: unknown) {
			console.error('[GradientViz] ESDT computation failed:', error);
		}
	}

	// Recompute when inputs change
	$effect(() => {
		// Dependencies
		inputText;
		useRelaxation;
		vizMode;

		if (dispatcherReady) {
			if (vizMode === 'gradient-arrows') {
				computeESDT();
			} else {
				renderFutharkVisualization();
			}
		}
	});

	// Re-visualize when display options change (gradient arrows mode only)
	$effect(() => {
		// Dependencies
		arrowScale;
		showDistanceMap;

		if (esdtData && vizMode === 'gradient-arrows') {
			visualizeGradients();
		}
	});
</script>

<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 overflow-hidden">
	<!-- Header -->
	<div class="px-4 py-3 border-b border-surface-300-600 bg-surface-100-800">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:compass" width={16} />
				ESDT Gradient Direction
				<span class="text-xs font-mono text-primary-500">(futhark/pipeline.fut)</span>
			</h3>
			<div class="flex items-center gap-2">
				{#if dispatcherReady}
					{#if activeBackendLabel === 'Futhark WebGPU'}
						<span class="flex items-center gap-1 text-xs text-success-500">
							<Icon icon="lucide:gpu" width={12} />
							Futhark WebGPU
						</span>
					{:else if activeBackendLabel === 'Futhark WASM'}
						<span class="flex items-center gap-1 text-xs text-success-500">
							<Icon icon="lucide:check" width={12} />
							Futhark WASM
						</span>
					{:else}
						<span class="flex items-center gap-1 text-xs text-warning-500">
							<Icon icon="lucide:cpu" width={12} />
							JS Fallback
						</span>
					{/if}
				{:else}
					<span class="flex items-center gap-1 text-xs text-surface-500-400">
						<span class="w-2 h-2 bg-surface-400 rounded-full animate-pulse"></span>
						Loading...
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Controls -->
	<div class="p-4 space-y-4">
		<!-- Text Input -->
		<div class="flex items-center gap-3">
			<label for="gradient-viz-text" class="text-sm text-surface-700-200 w-20">Text</label>
			<input
				id="gradient-viz-text"
				type="text"
				bind:value={inputText}
				class="flex-1 px-3 py-2 rounded bg-surface-100-800 border border-surface-300-600 text-surface-900-50 font-mono"
				placeholder="Enter text..."
			/>
		</div>

		<!-- Visualization Mode -->
		<div class="flex items-center gap-3">
			<label for="gradient-viz-mode" class="text-sm text-surface-700-200 w-20">Mode</label>
			<select
				id="gradient-viz-mode"
				bind:value={vizMode}
				class="flex-1 px-3 py-2 rounded bg-surface-100-800 border border-surface-300-600 text-surface-900-50 text-sm"
			>
				{#each VIZ_MODES as mode}
					<option
						value={mode.value}
						disabled={mode.requiresGPU && !dispatcher?.hasFutharkWebGPU}
					>
						{mode.label}{mode.requiresGPU && !dispatcher?.hasFutharkWebGPU ? ' (unavailable)' : ''}
					</option>
				{/each}
			</select>
		</div>

		<!-- Options (gradient arrows mode) -->
		{#if vizMode === 'gradient-arrows'}
			<div class="flex items-center gap-6">
				<label class="flex items-center gap-2 text-sm text-surface-700-200">
					<input
						type="checkbox"
						bind:checked={useRelaxation}
						class="rounded"
					/>
					Relaxation pass
				</label>
				<label class="flex items-center gap-2 text-sm text-surface-700-200">
					<input
						type="checkbox"
						bind:checked={showDistanceMap}
						class="rounded"
					/>
					Distance map
				</label>
				<div class="flex items-center gap-2">
					<span class="text-sm text-surface-700-200">Arrow scale:</span>
					<input
						type="range"
						min="2"
						max="16"
						bind:value={arrowScale}
						class="w-24"
					/>
					<span class="text-xs font-mono text-surface-500-400 w-6">{arrowScale}</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Canvas Container -->
	<div class="p-4 pt-0">
		<div class="relative bg-surface-100-800 rounded-lg overflow-hidden" style="width: {canvasWidth}px; height: {canvasHeight}px;">
			<!-- Text rendering canvas (hidden, just for data extraction) -->
			<canvas
				bind:this={textCanvas}
				width={canvasWidth}
				height={canvasHeight}
				class="absolute inset-0"
			></canvas>
			<!-- Vector visualization canvas -->
			<canvas
				bind:this={vectorCanvas}
				width={canvasWidth}
				height={canvasHeight}
				class="absolute inset-0"
			></canvas>
		</div>
	</div>

	<!-- Timing Metrics -->
	{#if showTiming}
		<div class="px-4 py-3 border-t border-surface-300-600 bg-surface-100-800">
			<div class="flex items-center justify-between text-xs">
				<div class="flex items-center gap-4">
					<span class="text-surface-500-400">
						Processing: <span class="font-mono text-surface-900-50">{processingTimeMs.toFixed(2)}</span> ms
					</span>
					<span class="text-surface-500-400">|</span>
					<span class="text-surface-500-400">
						Pixels: <span class="font-mono text-surface-900-50">{pixelCount.toLocaleString()}</span>
					</span>
					<span class="text-surface-500-400">|</span>
					<span class="text-surface-500-400">
						Throughput: <span class="font-mono text-surface-900-50">{(pixelCount / processingTimeMs).toFixed(0)}</span> px/ms
					</span>
				</div>
				<span class="font-mono text-primary-500">{activeBackendLabel || 'initializing'}</span>
			</div>
		</div>
	{/if}

	<!-- Algorithm Reference -->
	<div class="px-4 py-3 border-t border-surface-300-600 bg-surface-50-900">
		<details class="text-xs text-surface-600-300">
			<summary class="cursor-pointer hover:text-surface-900-50 transition-colors">
				ESDT Algorithm Reference (Futhark Implementation)
			</summary>
			<div class="mt-2 space-y-1 font-mono">
				<div>Algorithm: <code class="text-primary-500">Extended Signed Distance Transform</code></div>
				<div>Passes: <code class="text-primary-500">X-pass (horizontal) + Y-pass (vertical)</code></div>
				<div>Output: <code class="text-primary-500">Per-pixel [delta_x, delta_y] vectors to nearest edge</code></div>
				<div>Relaxation: <code class="text-primary-500">Optional smoothing pass for anti-aliased edges</code></div>
			</div>
		</details>
	</div>
</div>
