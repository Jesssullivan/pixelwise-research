<script lang="ts">
	/**
	 * Before/After Demo - Redirects to Compositor
	 *
	 * The standalone color adjustment demo is not implemented as a separate component.
	 * While futhark/wcag.fut contains find_compliant_color(), it's not exposed as a
	 * standalone entry point in the WASM module.
	 *
	 * To see color adjustment in action, use the Live Compositor Demo which
	 * runs the complete 6-stage ESDT pipeline including contrast-based color adjustment.
	 *
	 * @see futhark/wcag.fut - find_compliant_color() implementation
	 */

	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';

	onMount(() => {
		// Auto-redirect after showing message
		setTimeout(() => goto('/demo/compositor'), 5000);
	});
</script>

<div class="min-h-screen flex items-center justify-center p-8">
	<div class="max-w-lg text-center">
		<div class="mb-6">
			<Icon icon="lucide:info" width={48} class="text-primary-500 mx-auto" />
		</div>
		<h1 class="text-2xl font-bold text-surface-900-50 mb-4">Demo Integrated into Compositor</h1>
		<p class="text-surface-700-200 mb-4">
			The before/after comparison is best demonstrated in the
			<strong>Live Compositor Demo</strong> where you can toggle the enhancer on/off
			to see the contrast adjustment in real-time.
		</p>
		<p class="text-surface-700-200 mb-6">
			The color adjustment logic is implemented in
			<code class="font-mono bg-surface-200-700 px-1 rounded text-sm">futhark/wcag.fut</code>
			and integrated into the full ESDT pipeline.
		</p>
		<p class="text-sm text-surface-500-400 mb-6">Redirecting in 5 seconds...</p>
		<a
			href="/demo/compositor"
			class="btn preset-filled-primary-500 text-white inline-flex items-center gap-2"
		>
			<Icon icon="lucide:cpu" width={18} />
			Go to Live Compositor
		</a>
	</div>
</div>
