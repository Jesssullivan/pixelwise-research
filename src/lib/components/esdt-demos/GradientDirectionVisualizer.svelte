<script lang="ts">
	/**
	 * GradientDirectionVisualizer - ESDT Gradient Direction Visualization
	 *
	 * This component uses the Futhark WASM module (esdt.fut) directly
	 * to compute the Extended Signed Distance Transform.
	 *
	 * The ESDT algorithm uses 2D separable passes (X-pass + Y-pass)
	 * to compute distance and gradient vectors to the nearest edge.
	 *
	 * @see futhark/esdt.fut - compute_esdt_2d() implementation
	 */

	import Icon from '@iconify/svelte';
	import { onMount, onDestroy } from 'svelte';

	// Props
	interface Props {
		initialText?: string;
		showTiming?: boolean;
	}

	let { initialText = 'Aa', showTiming = true }: Props = $props();

	// Futhark context interface
	interface FutharkContext {
		new_f32_2d(data: Float32Array, rows: number, cols: number): FutharkArray;
		compute_esdt_2d(input: FutharkArray, useRelaxation: boolean): FutharkArray;
	}

	interface FutharkArray {
		toTypedArray(): Promise<Float32Array>;
		free(): void;
	}

	// Futhark context
	let futharkContext: FutharkContext | null = null;
	let futharkReady = $state(false);

	// Canvas refs
	let textCanvas: HTMLCanvasElement | null = null;
	let vectorCanvas: HTMLCanvasElement | null = null;

	// State
	let inputText = $state(initialText);
	let useRelaxation = $state(false);
	let arrowScale = $state(8);
	let showDistanceMap = $state(true);

	// Metrics
	let processingTimeMs = $state(0);
	let pixelCount = $state(0);
	let canvasWidth = $state(200);
	let canvasHeight = $state(100);

	// ESDT data (flat array: [delta_x, delta_y, ...])
	let esdtData: Float32Array | null = null;

	// Initialize - try Futhark WASM, fall back to JS
	let usingJsFallback = $state(false);

	onMount(async () => {
		try {
			const { newFutharkContext } = await import('$lib/futhark');
			futharkContext = await newFutharkContext();
			futharkReady = true;
			computeESDT();
		} catch (error) {
			console.warn('[GradientViz] Futhark initialization failed, using JS fallback:', error);
			// Use JS fallback instead
			futharkReady = true;
			usingJsFallback = true;
			computeESDT();
		}
	});

	onDestroy(() => {
		futharkContext = null;
	});

	/**
	 * Render text to canvas and extract grayscale levels
	 */
	function renderTextToLevels(): { levels: Float32Array; width: number; height: number } | null {
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

		// Convert to grayscale levels [0.0-1.0]
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

		return { levels, width: canvasWidth, height: canvasHeight };
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
	 * Pure JS ESDT fallback (simplified 2-pass algorithm)
	 */
	function computeEsdtFallback(levels: Float32Array, width: number, height: number): Float32Array {
		const data = new Float32Array(width * height * 2);

		// Initialize: foreground (level >= 0.5) = 0 distance, background = infinity
		for (let i = 0; i < width * height; i++) {
			if (levels[i] >= 0.5) {
				data[i * 2] = 0;
				data[i * 2 + 1] = 0;
			} else {
				data[i * 2] = 1e10;
				data[i * 2 + 1] = 1e10;
			}
		}

		// X-pass forward
		for (let y = 0; y < height; y++) {
			for (let x = 1; x < width; x++) {
				const idx = (y * width + x) * 2;
				const prevIdx = (y * width + x - 1) * 2;
				const candX = data[prevIdx] + 1;
				const candY = data[prevIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// X-pass backward
		for (let y = 0; y < height; y++) {
			for (let x = width - 2; x >= 0; x--) {
				const idx = (y * width + x) * 2;
				const nextIdx = (y * width + x + 1) * 2;
				const candX = data[nextIdx] - 1;
				const candY = data[nextIdx + 1];
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass forward
		for (let x = 0; x < width; x++) {
			for (let y = 1; y < height; y++) {
				const idx = (y * width + x) * 2;
				const prevIdx = ((y - 1) * width + x) * 2;
				const candX = data[prevIdx];
				const candY = data[prevIdx + 1] + 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		// Y-pass backward
		for (let x = 0; x < width; x++) {
			for (let y = height - 2; y >= 0; y--) {
				const idx = (y * width + x) * 2;
				const nextIdx = ((y + 1) * width + x) * 2;
				const candX = data[nextIdx];
				const candY = data[nextIdx + 1] - 1;
				const candD2 = candX * candX + candY * candY;
				const currD2 = data[idx] * data[idx] + data[idx + 1] * data[idx + 1];
				if (candD2 < currD2) {
					data[idx] = candX;
					data[idx + 1] = candY;
				}
			}
		}

		return data;
	}

	/**
	 * Compute ESDT and visualize
	 */
	async function computeESDT() {
		if (!futharkReady) return;

		const data = renderTextToLevels();
		if (!data) return;

		try {
			const startTime = performance.now();
			let resultData: Float32Array;

			if (futharkContext && !usingJsFallback) {
				// Use Futhark WASM
				const levels2d = futharkContext.new_f32_2d(data.levels, data.height, data.width);
				const result = futharkContext.compute_esdt_2d(levels2d, useRelaxation);
				resultData = await result.toTypedArray();
				result.free();
				levels2d.free();
			} else {
				// Use JS fallback
				resultData = computeEsdtFallback(data.levels, data.width, data.height);
			}

			const elapsed = performance.now() - startTime;

			esdtData = resultData;
			pixelCount = data.width * data.height;
			processingTimeMs = elapsed;

			visualizeGradients();

			const backend = usingJsFallback ? 'JS fallback' : 'Futhark WASM';
			console.log(`[GradientViz] compute_esdt_2d (${backend}): ${pixelCount} pixels in ${processingTimeMs.toFixed(2)}ms`);
		} catch (error) {
			console.error('[GradientViz] ESDT computation failed:', error);
		}
	}

	// Recompute when inputs change
	$effect(() => {
		// Dependencies
		inputText;
		useRelaxation;

		if (futharkReady) {
			computeESDT();
		}
	});

	// Re-visualize when display options change
	$effect(() => {
		// Dependencies
		arrowScale;
		showDistanceMap;

		if (esdtData) {
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
				<span class="text-xs font-mono text-primary-500">(futhark/esdt.fut)</span>
			</h3>
			<div class="flex items-center gap-2">
				{#if futharkReady}
					{#if usingJsFallback}
						<span class="flex items-center gap-1 text-xs text-warning-500">
							<Icon icon="lucide:cpu" width={12} />
							JS Fallback
						</span>
					{:else}
						<span class="flex items-center gap-1 text-xs text-success-500">
							<Icon icon="lucide:check" width={12} />
							Futhark WASM
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
			<label class="text-sm text-surface-700-200 w-20">Text</label>
			<input
				type="text"
				bind:value={inputText}
				class="flex-1 px-3 py-2 rounded bg-surface-100-800 border border-surface-300-600 text-surface-900-50 font-mono"
				placeholder="Enter text..."
			/>
		</div>

		<!-- Options -->
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
				<span class="font-mono text-primary-500">{usingJsFallback ? 'JS fallback' : 'esdt.fut'}</span>
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
