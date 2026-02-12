<script lang="ts">
	import DemoSidebar from '$lib/components/demo-layout/DemoSidebar.svelte';
	import WebGPUInstructions from '$lib/components/WebGPUInstructions.svelte';
	import { useWebGPUStatus } from '$lib/composables/useWebGPUStatus.svelte';
	import '../../app.css';

	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	const webgpu = useWebGPUStatus();
	const blocked = $derived(!webgpu.isDetecting && !webgpu.available);
</script>

<div class="flex min-h-screen bg-surface-100-800 text-surface-900-50">
	<!-- Sidebar -->
	<DemoSidebar />

	<!-- Main Content Area -->
	<main class="flex-1 overflow-y-auto">
		{#if webgpu.isDetecting}
			<div class="flex h-full items-center justify-center p-8">
				<div class="flex items-center gap-3">
					<svg class="h-5 w-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					<p class="text-surface-500-400">Detecting WebGPU capabilities...</p>
				</div>
			</div>
		{:else if blocked}
			<div class="flex h-full items-center justify-center p-8">
				<div class="max-w-lg space-y-4 text-center">
					<h2 class="text-xl font-bold text-error-500">WebGPU Required</h2>
					<p class="text-sm text-surface-600-300">
						The Pixelwise demos require WebGPU. Please enable WebGPU in your browser
						or switch to a supported browser, then reload the page.
					</p>
					{#if webgpu.capabilities}
						<WebGPUInstructions capabilities={webgpu.capabilities} onRecheck={webgpu.redetect} />
					{/if}
				</div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>
