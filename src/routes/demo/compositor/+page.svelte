<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import DemoHeader from '$lib/components/demo-layout/DemoHeader.svelte';
	import Icon from '@iconify/svelte';
	import { useContrastEnhancer } from '$lib/composables/useContrastEnhancer.svelte';
	import type { WCAGLevel } from '$lib/stores/pixelwiseStore.svelte';

	// The new clean Futhark-based enhancer
	let enhancer: ReturnType<typeof useContrastEnhancer> | null = $state(null);

	// UI State
	let enhancerEnabled = $state(false);
	let wcagLevel = $state<WCAGLevel>('AA');
	let showOriginal = $state(false);

	// Derived from enhancer stats
	let stats = $derived(enhancer?.stats ?? {
		frameCount: 0,
		lastFrameTime: 0,
		averageFrameTime: 0,
		glyphPixelCount: 0,
		adjustedPixelCount: 0,
		backend: 'none'
	});

	let isInitialized = $derived(enhancer?.isInitialized ?? false);
	let error = $derived(enhancer?.error ?? null);

	onMount(async () => {
		if (!browser) return;

		// Initialize the new Futhark-based contrast enhancer
		enhancer = useContrastEnhancer({
			targetContrast: wcagLevel === 'AAA' ? 7.0 : 4.5,
			maxDistance: 3.0,
			sampleDistance: 5.0,
			targetFps: 30,
			debug: false
		});

		// Wait for initialization
		await enhancer.initialize();

		if (enhancer.isInitialized) {
			console.log('[CompositorDemo] Futhark ESDT pipeline initialized');
			console.log('[CompositorDemo] Backend:', stats.backend);
		}
	});

	onDestroy(() => {
		if (enhancer) {
			enhancer.destroy();
		}
	});

	function toggleEnhancer() {
		if (!enhancer) return;

		enhancerEnabled = !enhancerEnabled;

		if (enhancerEnabled) {
			enhancer.start();
		} else {
			enhancer.stop();
		}
	}

	function setWCAGLevel(level: WCAGLevel) {
		wcagLevel = level;
		if (enhancer) {
			enhancer.setTargetContrast(level === 'AAA' ? 7.0 : 4.5);
		}
	}

	function toggleOriginalView() {
		showOriginal = !showOriginal;
		if (showOriginal && enhancer && enhancerEnabled) {
			enhancer.stop();
		} else if (!showOriginal && enhancer && enhancerEnabled) {
			enhancer.start();
		}
	}
</script>

<DemoHeader
	title="ESDT Contrast Enhancer"
	description="Screen Capture API + Futhark WASM ESDT pipeline with WebGL2 overlay"
/>

<div class="p-8 max-w-6xl mx-auto">
	<!-- Pipeline Status Panel -->
	<section class="mb-8 bg-surface-50-900 rounded-lg p-6 border border-surface-300-600">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-bold text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:cpu" width={24} />
				ESDT Pipeline Status
			</h2>

			<div class="flex items-center gap-4">
				<!-- WCAG Level Selector -->
				<div class="flex items-center gap-2">
					<span class="text-sm text-surface-600-300">WCAG Level:</span>
					<button
						class="px-3 py-1 rounded text-sm font-medium transition-colors {wcagLevel === 'AA'
							? 'bg-primary-500 text-white'
							: 'bg-surface-200-700 text-surface-700-200'}"
						onclick={() => setWCAGLevel('AA')}
					>
						AA (4.5:1)
					</button>
					<button
						class="px-3 py-1 rounded text-sm font-medium transition-colors {wcagLevel === 'AAA'
							? 'bg-primary-500 text-white'
							: 'bg-surface-200-700 text-surface-700-200'}"
						onclick={() => setWCAGLevel('AAA')}
					>
						AAA (7:1)
					</button>
				</div>

				<!-- Main Toggle -->
				<button
					class="px-4 py-2 rounded-lg font-medium transition-colors {enhancerEnabled
						? 'bg-success-500 text-white'
						: 'bg-primary-500 text-white'}"
					onclick={toggleEnhancer}
					disabled={!isInitialized}
				>
					{enhancerEnabled ? 'Stop Capture' : 'Start Screen Capture'}
				</button>
			</div>
		</div>

		<!-- Status Indicators -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div class="bg-surface-100-800 rounded-lg p-4">
				<div class="text-xs text-surface-500-400 uppercase tracking-wide mb-1">Backend</div>
				<div class="flex items-center gap-2">
					{#if isInitialized}
						<Icon icon="lucide:check-circle" class="text-success-500" width={18} />
						<span class="text-sm text-surface-900-50 font-mono">{stats.backend}</span>
					{:else}
						<Icon icon="lucide:loader" class="text-warning-500 animate-spin" width={18} />
						<span class="text-sm text-surface-600-300">Initializing...</span>
					{/if}
				</div>
			</div>

			<div class="bg-surface-100-800 rounded-lg p-4">
				<div class="text-xs text-surface-500-400 uppercase tracking-wide mb-1">Frame Time</div>
				<div class="flex items-center gap-2">
					<Icon icon="lucide:timer" class="text-secondary-500" width={18} />
					<span class="text-sm text-surface-900-50 font-mono">
						{stats.averageFrameTime > 0 ? stats.averageFrameTime.toFixed(1) : '--'}ms
					</span>
				</div>
			</div>

			<div class="bg-surface-100-800 rounded-lg p-4">
				<div class="text-xs text-surface-500-400 uppercase tracking-wide mb-1">Glyph Pixels</div>
				<div class="flex items-center gap-2">
					<Icon icon="lucide:type" class="text-primary-500" width={18} />
					<span class="text-sm text-surface-900-50 font-mono">{stats.glyphPixelCount.toLocaleString()}</span>
				</div>
			</div>

			<div class="bg-surface-100-800 rounded-lg p-4">
				<div class="text-xs text-surface-500-400 uppercase tracking-wide mb-1">Adjusted</div>
				<div class="flex items-center gap-2">
					<Icon icon="lucide:contrast" class="text-warning-500" width={18} />
					<span class="text-sm text-surface-900-50 font-mono">{stats.adjustedPixelCount.toLocaleString()}</span>
				</div>
			</div>
		</div>

		{#if !enhancerEnabled && isInitialized}
			<div class="mt-4 p-3 bg-primary-500/20 border border-primary-500/50 rounded-lg">
				<div class="flex items-center gap-2 text-primary-500">
					<Icon icon="lucide:monitor" width={18} />
					<span class="text-sm">
						Click "Start Screen Capture" to begin. You'll be prompted to select a screen, window, or tab to capture.
						The ESDT pipeline will process the captured frames in real-time.
					</span>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="mt-4 p-3 bg-error-500/20 border border-error-500/50 rounded-lg">
				<div class="flex items-center gap-2 text-error-500">
					<Icon icon="lucide:alert-circle" width={18} />
					<span class="text-sm">{error.message}</span>
				</div>
			</div>
		{/if}
	</section>

	<!-- Original/Enhanced Toggle -->
	<section class="mb-8">
		<div class="flex items-center justify-center gap-4 mb-4">
			<button
				class="px-4 py-2 rounded-lg font-medium transition-colors {showOriginal
					? 'bg-surface-200-700 text-surface-700-200'
					: 'bg-primary-500 text-white'}"
				onclick={toggleOriginalView}
			>
				{showOriginal ? 'Showing Original' : 'Showing Enhanced'}
			</button>
		</div>
	</section>

	<!-- Sample Content for Enhancement -->
	<section class="space-y-6">
		<h2 class="text-lg font-semibold text-surface-900-50 mb-4">
			Sample Content (Enhancement Target)
		</h2>

		<!-- Light Gradient Background -->
		<div class="bg-gradient-to-r from-yellow-200 to-orange-300 rounded-lg p-8">
			<h3 class="text-2xl font-bold text-gray-700 mb-2">Light Gradient Background</h3>
			<p class="text-gray-600">
				This text is processed by the Futhark ESDT pipeline. The Exact Signed Distance Transform
				computes sub-pixel accurate distances from each pixel to the nearest glyph edge, providing
				the gradient direction for background sampling.
			</p>
			<p class="text-sm text-gray-500 mt-2">
				ESDT: Δx, Δy offset vectors | Edge weight: 4α(1-α) peaks at coverage=0.5
			</p>
		</div>

		<!-- Dark Gradient Background -->
		<div class="bg-gradient-to-br from-purple-900 to-indigo-900 rounded-lg p-8">
			<h3 class="text-2xl font-bold text-gray-300 mb-2">Dark Gradient Background</h3>
			<p class="text-gray-400">
				Futhark compiles to WASM with multicore support, enabling parallel processing across
				CPU threads in the browser. The ESDT algorithm runs in O(n) time complexity using
				separable X/Y passes.
			</p>
			<p class="text-sm text-gray-500 mt-2">
				WCAG 2.1: L = 0.2126R + 0.7152G + 0.0722B | CR = (L₁ + 0.05) / (L₂ + 0.05)
			</p>
		</div>

		<!-- Complex Pattern Background -->
		<div
			class="rounded-lg p-8"
			style="background: repeating-linear-gradient(45deg, #f0f0f0, #f0f0f0 10px, #e0e0e0 10px, #e0e0e0 20px);"
		>
			<h3 class="text-2xl font-bold text-gray-800 mb-2">Complex Pattern Background</h3>
			<p class="text-gray-700">
				The pipeline samples background colors along the ESDT gradient direction, outward from
				each glyph pixel. This ensures accurate background estimation even on complex patterns.
			</p>
			<p class="text-sm text-gray-600 mt-2">
				Gradient = (Δx, Δy) / √(Δx² + Δy²) | Sample at: pixel + gradient × sample_distance
			</p>
		</div>

		<!-- Solid Color with Low Contrast -->
		<div class="bg-gray-400 rounded-lg p-8">
			<h3 class="text-2xl font-bold text-gray-500 mb-2">Intentionally Low Contrast</h3>
			<p class="text-gray-500">
				This section has intentionally low contrast text. When the enhancer is running, it detects
				these WCAG violations and applies hue-preserving color adjustments to meet the target
				contrast ratio.
			</p>
		</div>
	</section>

	<!-- Technical Details -->
	<section class="mt-8 bg-primary-500/10 border border-primary-500/30 rounded-lg p-6">
		<h3 class="text-lg font-semibold text-primary-500 mb-4 flex items-center gap-2">
			<Icon icon="lucide:info" width={20} />
			6-Pass ESDT Pipeline (Futhark WASM)
		</h3>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-surface-700-200">
			<div>
				<h4 class="font-medium text-surface-900-50 mb-2">Passes 1-3: Distance Transform</h4>
				<ol class="list-decimal list-inside space-y-1">
					<li>Grayscale + Sobel gradient computation</li>
					<li>ESDT X-pass (horizontal propagation)</li>
					<li>ESDT Y-pass (vertical propagation)</li>
				</ol>
			</div>
			<div>
				<h4 class="font-medium text-surface-900-50 mb-2">Passes 4-6: Contrast Enhancement</h4>
				<ol class="list-decimal list-inside space-y-1" start="4">
					<li>Glyph extraction (distance &lt; threshold)</li>
					<li>Background sampling (outward along gradient)</li>
					<li>WCAG contrast check + color adjustment</li>
				</ol>
			</div>
		</div>

		<div class="mt-4 pt-4 border-t border-primary-500/30">
			<div class="flex flex-wrap gap-4 text-xs font-mono">
				<span class="px-2 py-1 bg-surface-200-700 rounded">futhark/esdt.fut</span>
				<span class="px-2 py-1 bg-surface-200-700 rounded">futhark/wcag.fut</span>
				<span class="px-2 py-1 bg-surface-200-700 rounded">futhark/pipeline.fut</span>
				<span class="px-2 py-1 bg-surface-200-700 rounded">wasm-multicore</span>
			</div>
		</div>
	</section>
</div>
