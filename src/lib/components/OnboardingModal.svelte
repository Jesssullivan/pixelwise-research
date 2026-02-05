<script lang="ts">
	import { browser } from '$app/environment';
	import WebGPUInstructions from './WebGPUInstructions.svelte';
	import PaperViewer from './PaperViewer.svelte';
	import { completeOnboarding } from '$lib/utils/consentStorage';
	import { useWebGPUStatus } from '$lib/composables/useWebGPUStatus.svelte';

	interface Props {
		/** Callback when modal is closed */
		onClose?: () => void;
	}

	let { onClose }: Props = $props();

	let isOpen = $state(true);
	let dontShowAgain = $state(true); // Default to checked
	let activeSection = $state<'webgpu' | 'capture' | 'paper'>('webgpu');

	// Use the reactive WebGPU status hook
	const webgpu = useWebGPUStatus();

	function handleContinue() {
		if (dontShowAgain) {
			completeOnboarding();
		}
		isOpen = false;
		onClose?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		// Only close if clicking the backdrop itself, not the modal content
		if (event.target === event.currentTarget) {
			handleContinue();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleContinue();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-title"
	>
		<!-- Modal -->
		<div class="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-surface-50-900 shadow-2xl flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-surface-200-700 px-6 py-4">
				<div>
					<h2 id="onboarding-title" class="text-xl font-bold text-surface-900-50">
						Welcome to Pixelwise
					</h2>
					<p class="mt-1 text-sm text-surface-600-300">
						WebGPU + Futhark WASM multicore compositor for WCAG contrast
					</p>
				</div>
				<button
					type="button"
					class="rounded-lg p-2 text-surface-500-400 transition-colors hover:bg-surface-100-800"
					onclick={handleContinue}
					aria-label="Close"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Tab Navigation -->
			<div class="flex border-b border-surface-200-700">
				<button
					type="button"
					class="flex-1 px-4 py-3 text-sm font-medium transition-colors
						{activeSection === 'webgpu'
							? 'border-b-2 border-primary-500 text-primary-500'
							: 'text-surface-600-300 hover:text-surface-900-50'}"
					onclick={() => activeSection = 'webgpu'}
				>
					WebGPU Status
				</button>
				<button
					type="button"
					class="flex-1 px-4 py-3 text-sm font-medium transition-colors
						{activeSection === 'capture'
							? 'border-b-2 border-primary-500 text-primary-500'
							: 'text-surface-600-300 hover:text-surface-900-50'}"
					onclick={() => activeSection = 'capture'}
				>
					Screen Capture
				</button>
				<button
					type="button"
					class="flex-1 px-4 py-3 text-sm font-medium transition-colors
						{activeSection === 'paper'
							? 'border-b-2 border-primary-500 text-primary-500'
							: 'text-surface-600-300 hover:text-surface-900-50'}"
					onclick={() => activeSection = 'paper'}
				>
					Research Paper
				</button>
			</div>

			<!-- Body - Scrollable -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if activeSection === 'webgpu'}
					<!-- WebGPU Section -->
					<div class="space-y-4">
						<p class="text-sm text-surface-700-200">
							Pixelwise uses WebGPU for real-time WCAG contrast analysis. Check your browser's compatibility below.
						</p>

						{#if webgpu.isDetecting}
							<div class="flex items-center gap-2 rounded-lg bg-surface-200-700 p-3">
								<svg class="h-5 w-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								<span class="text-sm">Detecting WebGPU capabilities...</span>
							</div>
						{:else if webgpu.capabilities}
							<WebGPUInstructions capabilities={webgpu.capabilities} />
						{/if}

						<!-- Additional capability indicators -->
						{#if webgpu.capabilities}
							<div class="mt-4 grid grid-cols-2 gap-2 text-xs">
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									{#if webgpu.capabilities.wasm}
										<span class="h-2 w-2 rounded-full bg-success-500"></span>
									{:else}
										<span class="h-2 w-2 rounded-full bg-error-500"></span>
									{/if}
									<span class="text-surface-700-200">WebAssembly</span>
								</div>
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									{#if webgpu.capabilities.sharedArrayBuffer}
										<span class="h-2 w-2 rounded-full bg-success-500"></span>
									{:else}
										<span class="h-2 w-2 rounded-full bg-warning-500"></span>
									{/if}
									<span class="text-surface-700-200">SharedArrayBuffer</span>
								</div>
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									{#if webgpu.capabilities.screenCapture}
										<span class="h-2 w-2 rounded-full bg-success-500"></span>
									{:else}
										<span class="h-2 w-2 rounded-full bg-error-500"></span>
									{/if}
									<span class="text-surface-700-200">Screen Capture API</span>
								</div>
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									{#if webgpu.capabilities.offscreenCanvas}
										<span class="h-2 w-2 rounded-full bg-success-500"></span>
									{:else}
										<span class="h-2 w-2 rounded-full bg-warning-500"></span>
									{/if}
									<span class="text-surface-700-200">OffscreenCanvas</span>
								</div>
							</div>
						{/if}
					</div>

				{:else if activeSection === 'capture'}
					<!-- Screen Capture Section -->
					<div class="space-y-4">
						<div class="rounded-lg border border-surface-300-600 bg-surface-100-800 p-4">
							<h4 class="mb-2 flex items-center gap-2 font-semibold text-surface-900-50">
								<svg class="h-5 w-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
								</svg>
								Why Screen Capture?
							</h4>
							<p class="text-sm text-surface-700-200">
								The compositor analyzes the rendered page to calculate WCAG-compliant contrast adjustments.
								This requires capturing the current visual state of the page.
							</p>
						</div>

						<div class="rounded-lg border border-surface-300-600 bg-surface-100-800 p-4">
							<h4 class="mb-2 flex items-center gap-2 font-semibold text-surface-900-50">
								<svg class="h-5 w-5 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
								</svg>
								Privacy Assurance
							</h4>
							<ul class="ml-5 list-disc space-y-1 text-sm text-surface-700-200">
								<li>All processing happens <strong>locally in your browser</strong></li>
								<li>No data is sent to any server</li>
								<li>Frame buffers are immediately discarded after processing</li>
								<li>The capture only includes the current tab content</li>
							</ul>
						</div>

						<div class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
							<h4 class="mb-2 flex items-center gap-2 font-semibold text-warning-700 dark:text-warning-400">
								<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								Permission Required
							</h4>
							<p class="text-sm text-surface-700-200">
								When you start the compositor, your browser will ask for screen capture permission.
								You'll need to select this tab/window for the demo to work.
							</p>
						</div>
					</div>

				{:else if activeSection === 'paper'}
					<!-- Research Paper Section -->
					<div class="space-y-4">
						<p class="text-sm text-surface-700-200">
							Learn about the Extended Signed Distance Transform (ESDT) algorithm, the 6-pass
							WebGPU pipeline, and how Pixelwise achieves WCAG-compliant text contrast enhancement.
						</p>
						<PaperViewer collapsed={false} maxHeight="45vh" />
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-surface-200-700 px-6 py-4">
				<label class="flex items-center gap-2 text-sm text-surface-600-300">
					<input
						type="checkbox"
						bind:checked={dontShowAgain}
						class="h-4 w-4 rounded border-surface-400-500 text-primary-500 focus:ring-primary-500"
					/>
					Don't show again
				</label>
				<button
					type="button"
					class="rounded-lg bg-primary-500 px-6 py-2 font-medium text-white transition-colors hover:bg-primary-600"
					onclick={handleContinue}
				>
					Continue to Demo
				</button>
			</div>

			<!-- Disclaimer -->
			<div class="border-t border-surface-200-700 bg-surface-100-800 px-6 py-3">
				<p class="text-center text-xs text-surface-500-400">
					This is research software exploring WebGPU and Futhark WASM for accessibility.
					Not intended for production use.
				</p>
			</div>
		</div>
	</div>
{/if}
