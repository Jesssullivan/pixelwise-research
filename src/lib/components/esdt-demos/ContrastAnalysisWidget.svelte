<script lang="ts">
	/**
	 * ContrastAnalysisWidget - WCAG Contrast Analysis using WASM SIMD
	 *
	 * This component computes WCAG 2.1 contrast ratios for color pairs using
	 * the real WASM worker via MessageType.BatchContrast. When WASM is unavailable,
	 * it falls back to a pure TypeScript implementation.
	 *
	 * The WCAG formula:
	 * - Linearize RGB values using sRGB gamma (threshold 0.03928, gamma 2.4)
	 * - Compute relative luminance: L = 0.2126R + 0.7152G + 0.0722B
	 * - Contrast ratio: CR = (L1 + 0.05) / (L2 + 0.05) where L1 >= L2
	 *
	 * @see futhark/wcag.fut - WCAG contrast calculation reference
	 * @see src/lib/workers/text-manipulation.worker.ts - BatchContrast handler
	 */

	import Icon from '@iconify/svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { MessageType, type WorkerMessage, type WorkerResponse, type BatchContrastPayload } from '$lib/workers/text-manipulation.types';

	interface ColorPair {
		id: number;
		textColor: { r: number; g: number; b: number };
		bgColor: { r: number; g: number; b: number };
		contrastRatio: number | null;
		isAA: boolean;
		isAAA: boolean;
	}

	// Props
	interface Props {
		showTiming?: boolean;
		initialPairs?: Array<{ text: { r: number; g: number; b: number }; bg: { r: number; g: number; b: number } }>;
	}

	let { showTiming = true, initialPairs }: Props = $props();

	// Worker state
	let worker: Worker | null = null;
	let workerReady = $state(false);
	let simdEnabled = $state(false);
	let requestId = 0;
	let pendingRequests = new Map<number, { resolve: (value: Float32Array) => void; reject: (error: Error) => void }>();

	// Color pairs for analysis
	let colorPairs = $state<ColorPair[]>(
		initialPairs?.map((pair, idx) => ({
			id: idx + 1,
			textColor: pair.text,
			bgColor: pair.bg,
			contrastRatio: null,
			isAA: false,
			isAAA: false
		})) ?? [
			{ id: 1, textColor: { r: 0, g: 0, b: 0 }, bgColor: { r: 255, g: 255, b: 255 }, contrastRatio: null, isAA: false, isAAA: false },
			{ id: 2, textColor: { r: 255, g: 255, b: 255 }, bgColor: { r: 0, g: 0, b: 0 }, contrastRatio: null, isAA: false, isAAA: false },
			{ id: 3, textColor: { r: 128, g: 128, b: 128 }, bgColor: { r: 255, g: 255, b: 255 }, contrastRatio: null, isAA: false, isAAA: false },
			{ id: 4, textColor: { r: 0, g: 102, b: 204 }, bgColor: { r: 255, g: 255, b: 255 }, contrastRatio: null, isAA: false, isAAA: false },
			{ id: 5, textColor: { r: 255, g: 0, b: 0 }, bgColor: { r: 255, g: 255, b: 255 }, contrastRatio: null, isAA: false, isAAA: false },
			{ id: 6, textColor: { r: 0, g: 128, b: 0 }, bgColor: { r: 255, g: 255, b: 255 }, contrastRatio: null, isAA: false, isAAA: false }
		]
	);

	// Performance metrics
	let lastProcessingTimeUs = $state(0);
	let pairsPerMs = $state(0);
	let usingJsFallback = $state(false);

	/**
	 * Initialize the WASM worker
	 */
	async function initWorker(): Promise<boolean> {
		try {
			worker = new Worker(
				new URL('$lib/workers/text-manipulation.worker.ts', import.meta.url),
				{ type: 'module' }
			);

			worker.onmessage = handleWorkerMessage;
			worker.onerror = (e) => {
				console.error('[ContrastWidget] Worker error:', e);
			};

			// Initialize the worker
			const initResult = await sendWorkerMessage<{ initialized: boolean }>(MessageType.Init, {});
			if (!initResult.initialized) {
				console.warn('[ContrastWidget] Worker init returned false, using JS fallback');
				return false;
			}

			// Check SIMD status via ping
			const pingResult = await sendWorkerMessage<{ pong: boolean; simdEnabled: boolean }>(MessageType.Ping, {});
			simdEnabled = pingResult.simdEnabled ?? false;
			workerReady = true;

			console.log(`[ContrastWidget] Worker ready, SIMD: ${simdEnabled}`);
			return true;
		} catch (error) {
			console.warn('[ContrastWidget] Worker initialization failed, using JS fallback:', error);
			return false;
		}
	}

	/**
	 * Send message to worker and await response
	 */
	function sendWorkerMessage<T>(type: MessageType, payload: unknown): Promise<T> {
		return new Promise((resolve, reject) => {
			if (!worker) {
				reject(new Error('Worker not initialized'));
				return;
			}

			const id = requestId++;
			pendingRequests.set(id, {
				resolve: resolve as (value: Float32Array) => void,
				reject
			});

			const message: WorkerMessage = { type, id, payload };
			worker.postMessage(message);
		});
	}

	/**
	 * Handle worker response messages
	 */
	function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
		const { id, success, data, error } = event.data;

		const pending = pendingRequests.get(id);
		if (!pending) return;

		pendingRequests.delete(id);

		if (success) {
			pending.resolve(data as Float32Array);
		} else {
			pending.reject(new Error(error ?? 'Unknown worker error'));
		}
	}

	/**
	 * Pack color pairs into Uint8Array format for WASM processing
	 */
	function packColorPairs(pairs: ColorPair[]): { textRgb: Uint8Array; bgRgb: Uint8Array } {
		const textRgb = new Uint8Array(pairs.length * 3);
		const bgRgb = new Uint8Array(pairs.length * 3);

		for (let i = 0; i < pairs.length; i++) {
			textRgb[i * 3] = pairs[i].textColor.r;
			textRgb[i * 3 + 1] = pairs[i].textColor.g;
			textRgb[i * 3 + 2] = pairs[i].textColor.b;

			bgRgb[i * 3] = pairs[i].bgColor.r;
			bgRgb[i * 3 + 1] = pairs[i].bgColor.g;
			bgRgb[i * 3 + 2] = pairs[i].bgColor.b;
		}

		return { textRgb, bgRgb };
	}

	/**
	 * sRGB gamma correction per WCAG 2.1 spec (JS fallback)
	 */
	function toLinear(value: number): number {
		const v = value / 255;
		if (v <= 0.03928) {
			return v / 12.92;
		}
		return Math.pow((v + 0.055) / 1.055, 2.4);
	}

	/**
	 * Compute relative luminance per WCAG 2.1 (JS fallback)
	 */
	function relativeLuminance(r: number, g: number, b: number): number {
		return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
	}

	/**
	 * Compute contrast ratio per WCAG 2.1 (JS fallback)
	 */
	function contrastRatioJS(l1: number, l2: number): number {
		const lighter = Math.max(l1, l2);
		const darker = Math.min(l1, l2);
		return (lighter + 0.05) / (darker + 0.05);
	}

	/**
	 * Analyze all color pairs using JS fallback
	 */
	function analyzeAllPairsJS(): Float32Array {
		const pairs = untrack(() => colorPairs);
		const ratios = new Float32Array(pairs.length);

		for (let i = 0; i < pairs.length; i++) {
			const textLum = relativeLuminance(
				pairs[i].textColor.r,
				pairs[i].textColor.g,
				pairs[i].textColor.b
			);
			const bgLum = relativeLuminance(
				pairs[i].bgColor.r,
				pairs[i].bgColor.g,
				pairs[i].bgColor.b
			);
			ratios[i] = contrastRatioJS(textLum, bgLum);
		}

		return ratios;
	}

	/**
	 * Analyze all color pairs using WASM worker or JS fallback
	 */
	async function analyzeAllPairs() {
		const startTime = performance.now();
		const pairs = untrack(() => colorPairs);
		let ratios: Float32Array;

		if (workerReady && worker) {
			try {
				// Use WASM worker
				const { textRgb, bgRgb } = packColorPairs(pairs);
				const payload: BatchContrastPayload = { textRgb, bgRgb };
				const result = await sendWorkerMessage<{ ratios: Float32Array }>(
					MessageType.BatchContrast,
					payload
				);
				ratios = result.ratios;
				usingJsFallback = false;
			} catch (error) {
				console.warn('[ContrastWidget] Worker call failed, using JS fallback:', error);
				ratios = analyzeAllPairsJS();
				usingJsFallback = true;
			}
		} else {
			// JS fallback
			ratios = analyzeAllPairsJS();
			usingJsFallback = true;
		}

		const elapsed = performance.now() - startTime;

		// Update color pairs with results
		colorPairs = pairs.map((pair, i) => {
			const cr = ratios[i];
			return {
				...pair,
				contrastRatio: cr,
				isAA: cr >= 4.5,
				isAAA: cr >= 7.0
			};
		});

		lastProcessingTimeUs = Math.round(elapsed * 1000);
		pairsPerMs = pairs.length / elapsed;

		const backend = usingJsFallback ? 'JS fallback' : 'WASM worker';
		console.log(`[ContrastWidget] Analyzed ${pairs.length} pairs in ${elapsed.toFixed(2)}ms (${backend})`);
	}

	// Initialize worker and analyze on mount
	onMount(async () => {
		await initWorker();
		analyzeAllPairs();
	});

	// Cleanup worker on destroy
	onDestroy(() => {
		if (worker) {
			// Send dispose message
			worker.postMessage({ type: MessageType.Dispose, id: requestId++, payload: {} });
			worker.terminate();
			worker = null;
		}
		pendingRequests.clear();
	});

	/**
	 * Add a new color pair
	 */
	function addPair() {
		const newId = Math.max(...colorPairs.map(p => p.id)) + 1;
		colorPairs = [...colorPairs, {
			id: newId,
			textColor: { r: 0, g: 0, b: 0 },
			bgColor: { r: 255, g: 255, b: 255 },
			contrastRatio: null,
			isAA: false,
			isAAA: false
		}];
		analyzeAllPairs();
	}

	/**
	 * Remove a color pair
	 */
	function removePair(id: number) {
		if (colorPairs.length <= 1) return;
		colorPairs = colorPairs.filter(p => p.id !== id);
		// No need to re-analyze since we just removed a pair
	}

	/**
	 * Update a color and re-analyze
	 */
	function updateColor(pairId: number, type: 'text' | 'bg', color: string) {
		// Parse hex color
		const hex = color.replace('#', '');
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);

		colorPairs = colorPairs.map(pair => {
			if (pair.id !== pairId) return pair;
			return {
				...pair,
				[type === 'text' ? 'textColor' : 'bgColor']: { r, g, b }
			};
		});

		analyzeAllPairs();
	}

	/**
	 * Convert RGB to hex
	 */
	function rgbToHex(color: { r: number; g: number; b: number }): string {
		return '#' + [color.r, color.g, color.b]
			.map(c => c.toString(16).padStart(2, '0'))
			.join('');
	}
</script>

<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 overflow-hidden">
	<!-- Header -->
	<div class="px-4 py-3 border-b border-surface-300-600 bg-surface-100-800">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:contrast" width={16} />
				WCAG Contrast Analysis
				<span class="text-xs font-mono text-primary-500">(WASM Worker)</span>
			</h3>
			<div class="flex items-center gap-2">
				{#if workerReady}
					{#if usingJsFallback}
						<span class="flex items-center gap-1 text-xs text-warning-500">
							<Icon icon="lucide:cpu" width={12} />
							JS Fallback
						</span>
					{:else}
						<span class="flex items-center gap-1 text-xs text-success-500">
							<Icon icon="lucide:zap" width={12} />
							WASM Worker
						</span>
					{/if}
				{:else}
					<span class="flex items-center gap-1 text-xs text-surface-500-400">
						<span class="w-2 h-2 bg-surface-400 rounded-full animate-pulse"></span>
						Initializing...
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Color Pairs Grid -->
	<div class="p-4 space-y-3">
		{#each colorPairs as pair (pair.id)}
			<div class="flex items-center gap-3 bg-surface-100-800 rounded-lg p-3">
				<!-- Text Color -->
				<div class="flex items-center gap-2">
					<label for="text-color-{pair.id}" class="text-xs text-surface-500-400 w-8">Text</label>
					<input
						id="text-color-{pair.id}"
						type="color"
						value={rgbToHex(pair.textColor)}
						onchange={(e) => updateColor(pair.id, 'text', e.currentTarget.value)}
						class="w-8 h-8 rounded cursor-pointer border-0"
					/>
				</div>

				<!-- Background Color -->
				<div class="flex items-center gap-2">
					<label for="bg-color-{pair.id}" class="text-xs text-surface-500-400 w-8">Bg</label>
					<input
						id="bg-color-{pair.id}"
						type="color"
						value={rgbToHex(pair.bgColor)}
						onchange={(e) => updateColor(pair.id, 'bg', e.currentTarget.value)}
						class="w-8 h-8 rounded cursor-pointer border-0"
					/>
				</div>

				<!-- Preview -->
				<div
					class="flex-1 px-3 py-2 rounded text-sm font-medium text-center"
					style="background-color: {rgbToHex(pair.bgColor)}; color: {rgbToHex(pair.textColor)}"
				>
					Sample Text
				</div>

				<!-- Contrast Ratio -->
				<div class="w-20 text-center">
					{#if pair.contrastRatio !== null}
						<div class="text-lg font-mono font-bold text-surface-900-50">
							{pair.contrastRatio.toFixed(2)}
						</div>
						<div class="text-xs text-surface-500-400">:1</div>
					{:else}
						<div class="text-sm text-surface-500-400">--</div>
					{/if}
				</div>

				<!-- Compliance Badges -->
				<div class="flex items-center gap-1">
					<span
						class="px-2 py-0.5 text-xs font-semibold rounded {pair.isAA ? 'bg-success-500 text-white' : 'bg-surface-300-600 text-surface-500-400'}"
					>
						AA
					</span>
					<span
						class="px-2 py-0.5 text-xs font-semibold rounded {pair.isAAA ? 'bg-success-500 text-white' : 'bg-surface-300-600 text-surface-500-400'}"
					>
						AAA
					</span>
				</div>

				<!-- Remove Button -->
				<button
					onclick={() => removePair(pair.id)}
					class="p-1 text-surface-500-400 hover:text-error-500 transition-colors"
					disabled={colorPairs.length <= 1}
				>
					<Icon icon="lucide:x" width={16} />
				</button>
			</div>
		{/each}

		<!-- Add Button -->
		<button
			onclick={addPair}
			class="w-full py-2 border border-dashed border-surface-300-600 rounded-lg text-surface-500-400 hover:text-primary-500 hover:border-primary-500 transition-colors flex items-center justify-center gap-2"
		>
			<Icon icon="lucide:plus" width={16} />
			Add Color Pair
		</button>
	</div>

	<!-- Timing Metrics -->
	{#if showTiming}
		<div class="px-4 py-3 border-t border-surface-300-600 bg-surface-100-800">
			<div class="flex items-center justify-between text-xs">
				<div class="flex items-center gap-4">
					<span class="text-surface-500-400">
						Processing: <span class="font-mono text-surface-900-50">{lastProcessingTimeUs}</span> us
					</span>
					<span class="text-surface-500-400">|</span>
					<span class="text-surface-500-400">
						Throughput: <span class="font-mono text-surface-900-50">{pairsPerMs.toFixed(1)}</span> pairs/ms
					</span>
					<span class="text-surface-500-400">|</span>
					<span class="text-surface-500-400">
						Pairs: <span class="font-mono text-surface-900-50">{colorPairs.length}</span>
					</span>
				</div>
				<span class="font-mono text-primary-500">{usingJsFallback ? 'JS fallback' : 'WASM Worker'}</span>
			</div>
		</div>
	{/if}

	<!-- WCAG Formula Reference -->
	<div class="px-4 py-3 border-t border-surface-300-600 bg-surface-50-900">
		<details class="text-xs text-surface-600-300">
			<summary class="cursor-pointer hover:text-surface-900-50 transition-colors">
				WCAG 2.1 Formula Reference
			</summary>
			<div class="mt-2 space-y-1 font-mono">
				<div>Backend: <code class="text-primary-500">{usingJsFallback ? 'TypeScript fallback' : 'WASM Worker'}</code></div>
				<div>Linearization threshold: <code class="text-primary-500">0.03928</code></div>
				<div>Gamma exponent: <code class="text-primary-500">2.4</code></div>
				<div>Luminance: <code class="text-primary-500">0.2126R + 0.7152G + 0.0722B</code></div>
				<div>Contrast: <code class="text-primary-500">CR = (L1 + 0.05) / (L2 + 0.05)</code></div>
				<div>AA threshold: <code class="text-primary-500">4.5:1</code> | AAA threshold: <code class="text-primary-500">7.0:1</code></div>
			</div>
		</details>
	</div>
</div>
