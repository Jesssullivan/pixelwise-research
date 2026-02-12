<script lang="ts">
	import { browser } from '$app/environment';
	import WebGPUInstructions from './WebGPUInstructions.svelte';
	import PaperViewer from './PaperViewer.svelte';
	import MobileWarning from './MobileWarning.svelte';
	import { completeOnboarding, setConsent, getConsent, updateWebGPUAvailability } from '$lib/utils/consentStorage';
	import { useWebGPUStatus } from '$lib/composables/useWebGPUStatus.svelte';

	interface Props {
		/** Callback when modal is closed */
		onClose?: () => void;
	}

	let { onClose }: Props = $props();

	const TOTAL_STEPS = 5;
	let isOpen = $state(true);
	let currentStep = $state(1);
	let dontShowAgain = $state(true);
	let screenCaptureTestResult = $state<'untested' | 'testing' | 'granted' | 'denied'>('untested');

	const webgpu = useWebGPUStatus();

	// Gate: non-dismissable when WebGPU is unavailable
	const gated = $derived(!webgpu.isDetecting && !webgpu.available);

	// Update stored WebGPU availability when detection completes
	$effect(() => {
		if (!webgpu.isDetecting) {
			updateWebGPUAvailability(webgpu.available);
		}
	});

	// Track completed steps
	let completedSteps = $state<Set<number>>(new Set());

	function markStepCompleted(step: number) {
		completedSteps.add(step);
		setConsent({ completedSteps: [...completedSteps] });
	}

	function goToStep(step: number) {
		if (step < 1 || step > TOTAL_STEPS) return;
		markStepCompleted(currentStep);
		currentStep = step;
	}

	function nextStep() {
		if (currentStep < TOTAL_STEPS) {
			goToStep(currentStep + 1);
		}
	}

	function prevStep() {
		if (currentStep > 1) {
			goToStep(currentStep - 1);
		}
	}

	function handleFinish() {
		if (gated) return;
		markStepCompleted(currentStep);
		if (dontShowAgain) {
			completeOnboarding();
		}
		setConsent({
			detectedBackend: webgpu.available ? 'webgpu' : webgpu.fallbackMode,
			screenCaptureGranted: screenCaptureTestResult === 'granted'
		});
		isOpen = false;
		onClose?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (gated) return;
		if (event.target === event.currentTarget) {
			handleFinish();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !gated) {
			handleFinish();
		} else if (event.key === 'ArrowRight' || (event.key === 'Enter' && currentStep < TOTAL_STEPS)) {
			nextStep();
		} else if (event.key === 'ArrowLeft') {
			prevStep();
		}
	}

	async function testScreenCapture() {
		screenCaptureTestResult = 'testing';
		const granted = await webgpu.testScreenCapture();
		screenCaptureTestResult = granted ? 'granted' : 'denied';
	}

	async function recheckWebGPU() {
		await webgpu.redetect();
	}

	// Derive the performance tier label
	const performanceTier = $derived.by(() => {
		if (webgpu.available) return 'GPU Accelerated (WebGPU)';
		if (webgpu.fallbackMode === 'wasm-multicore') return 'CPU Multicore (Futhark WASM)';
		if (webgpu.fallbackMode === 'js-fallback') return 'CPU Single-thread (JS)';
		return 'Unknown';
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-title"
		tabindex="-1"
	>
		<div class="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-surface-50-900 shadow-2xl flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-surface-200-700 px-6 py-4">
				<div>
					<h2 id="onboarding-title" class="text-xl font-bold text-surface-900-50">
						{#if currentStep === 1}
							Welcome to Pixelwise
						{:else if currentStep === 2}
							WebGPU Check
						{:else if currentStep === 3}
							Screen Capture
						{:else if currentStep === 4}
							Research Paper
						{:else}
							Ready
						{/if}
					</h2>
					<p class="mt-1 text-sm text-surface-600-300">
						Step {currentStep} of {TOTAL_STEPS}
					</p>
				</div>
				{#if !gated}
					<button
						type="button"
						class="rounded-lg p-2 text-surface-500-400 transition-colors hover:bg-surface-100-800"
						onclick={handleFinish}
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>

			<!-- Progress Indicator -->
			<div class="flex gap-1 px-6 pt-3">
				{#each Array(TOTAL_STEPS) as _, i}
					<button
						type="button"
						class="h-1.5 flex-1 rounded-full transition-colors {i + 1 === currentStep
							? 'bg-primary-500'
							: i + 1 < currentStep || completedSteps.has(i + 1)
								? 'bg-primary-500/40'
								: 'bg-surface-200-700'}"
						onclick={() => goToStep(i + 1)}
						aria-label="Go to step {i + 1}"
					></button>
				{/each}
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if currentStep === 1}
					<!-- Step 1: Welcome + Platform Detection -->
					<div class="space-y-4">
						<p class="text-sm text-surface-700-200">
							Pixelwise is an experimental WCAG contrast enhancement compositor powered by Futhark WebGPU.
							This wizard will check your browser's compatibility and walk you through the setup.
						</p>

						<!-- Platform Info -->
						<div class="rounded-lg border border-surface-300-600 bg-surface-100-800 p-4">
							<h4 class="mb-2 text-sm font-semibold text-surface-900-50">Detected Platform</h4>
							<div class="grid grid-cols-2 gap-2 text-xs">
								<div class="flex items-center gap-2">
									<span class="text-surface-500-400">Browser:</span>
									<span class="font-mono text-surface-900-50">{webgpu.browserName} {webgpu.browserVersion}</span>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-surface-500-400">OS:</span>
									<span class="font-mono text-surface-900-50">{webgpu.platform}</span>
								</div>
							</div>
						</div>

						{#if webgpu.isMobile}
							<MobileWarning />
						{/if}
					</div>

				{:else if currentStep === 2}
					<!-- Step 2: WebGPU Check -->
					<div class="space-y-4">
						<p class="text-sm text-surface-700-200">
							Pixelwise uses WebGPU for real-time ESDT and WCAG contrast analysis on the GPU.
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
							<WebGPUInstructions capabilities={webgpu.capabilities} onRecheck={recheckWebGPU} />
						{/if}

						<!-- Capability Grid -->
						{#if webgpu.capabilities}
							<div class="grid grid-cols-2 gap-2 text-xs">
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									<span class="h-2 w-2 rounded-full {webgpu.capabilities.wasm ? 'bg-success-500' : 'bg-error-500'}"></span>
									<span class="text-surface-700-200">WebAssembly</span>
								</div>
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									<span class="h-2 w-2 rounded-full {webgpu.capabilities.sharedArrayBuffer ? 'bg-success-500' : 'bg-warning-500'}"></span>
									<span class="text-surface-700-200">SharedArrayBuffer</span>
								</div>
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									<span class="h-2 w-2 rounded-full {webgpu.capabilities.screenCapture ? 'bg-success-500' : 'bg-error-500'}"></span>
									<span class="text-surface-700-200">Screen Capture API</span>
								</div>
								<div class="flex items-center gap-2 rounded-lg bg-surface-100-800 px-3 py-2">
									<span class="h-2 w-2 rounded-full {webgpu.capabilities.offscreenCanvas ? 'bg-success-500' : 'bg-warning-500'}"></span>
									<span class="text-surface-700-200">OffscreenCanvas</span>
								</div>
							</div>
						{/if}

						{#if gated}
							<div class="rounded-lg border border-error-500/30 bg-error-500/10 p-3 text-sm text-error-700 dark:text-error-400">
								WebGPU is required to use the Pixelwise demos. Please follow the instructions above to enable WebGPU in your browser, then click "Re-check".
							</div>
						{/if}
					</div>

				{:else if currentStep === 3}
					<!-- Step 3: Screen Capture -->
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

						<!-- Test Permission Button -->
						<div class="flex flex-col items-center gap-2 rounded-lg border border-surface-300-600 bg-surface-50-900 p-4">
							{#if screenCaptureTestResult === 'untested'}
								<p class="text-sm text-surface-700-200">Test screen capture permission now (optional):</p>
								<button
									type="button"
									class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
									onclick={testScreenCapture}
								>
									<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
									</svg>
									Test Permission
								</button>
							{:else if screenCaptureTestResult === 'testing'}
								<div class="flex items-center gap-2">
									<svg class="h-5 w-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
									</svg>
									<span class="text-sm">Requesting permission...</span>
								</div>
							{:else if screenCaptureTestResult === 'granted'}
								<div class="flex items-center gap-2 text-success-500">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
									</svg>
									<span class="text-sm font-medium">Screen capture permission granted</span>
								</div>
							{:else}
								<div class="flex items-center gap-2 text-warning-500">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
									</svg>
									<span class="text-sm">Permission denied or cancelled</span>
								</div>
								<button
									type="button"
									class="text-xs text-primary-500 hover:underline"
									onclick={testScreenCapture}
								>
									Try again
								</button>
							{/if}
							<p class="text-xs text-surface-500-400 text-center">
								You'll be asked again when starting the compositor if you skip this.
							</p>
						</div>
					</div>

				{:else if currentStep === 4}
					<!-- Step 4: Research Paper (optional) -->
					<div class="space-y-4">
						<p class="text-sm text-surface-700-200">
							Learn about the Extended Signed Distance Transform (ESDT) algorithm, the 6-pass
							WebGPU pipeline, and how Pixelwise achieves WCAG-compliant text contrast enhancement.
						</p>
						<PaperViewer collapsed={false} maxHeight="45vh" />
						<p class="text-xs text-surface-500-400 text-center">
							This step is optional. You can view the paper later from the main page.
						</p>
					</div>

				{:else if currentStep === 5}
					<!-- Step 5: Ready -->
					<div class="space-y-4">
						{#if gated}
							<div class="rounded-lg border border-error-500/30 bg-error-500/10 p-4">
								<h4 class="mb-3 flex items-center gap-2 font-semibold text-error-700 dark:text-error-400">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
									</svg>
									WebGPU Required
								</h4>
								<p class="text-sm text-surface-700-200">
									The Pixelwise demos require a WebGPU-capable browser. Please go back to Step 2 for browser-specific instructions on enabling WebGPU, then click "Re-check".
								</p>
							</div>
						{:else}
							<div class="rounded-lg border border-success-500/30 bg-success-500/10 p-4">
								<h4 class="mb-3 flex items-center gap-2 font-semibold text-success-700 dark:text-success-400">
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									Setup Complete
								</h4>
								<div class="space-y-2 text-sm text-surface-700-200">
									<div class="flex items-center justify-between">
										<span>Backend:</span>
										<span class="font-mono text-surface-900-50">{performanceTier}</span>
									</div>
									<div class="flex items-center justify-between">
										<span>WebGPU:</span>
										<span class="font-mono {webgpu.available ? 'text-success-500' : 'text-warning-500'}">
											{webgpu.available ? 'Available' : 'Using fallback'}
										</span>
									</div>
									{#if webgpu.adapter}
										<div class="flex items-center justify-between">
											<span>GPU:</span>
											<span class="font-mono text-surface-900-50 text-xs">{webgpu.adapter}</span>
										</div>
									{/if}
									<div class="flex items-center justify-between">
										<span>Screen Capture:</span>
										<span class="font-mono {screenCaptureTestResult === 'granted' ? 'text-success-500' : 'text-surface-500-400'}">
											{screenCaptureTestResult === 'granted' ? 'Granted' : 'Will prompt on start'}
										</span>
									</div>
								</div>
							</div>

							<label class="flex items-center gap-2 text-sm text-surface-600-300">
								<input
									type="checkbox"
									bind:checked={dontShowAgain}
									class="h-4 w-4 rounded border-surface-400-500 text-primary-500 focus:ring-primary-500"
								/>
								Don't show this wizard again
							</label>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer Navigation -->
			<div class="flex items-center justify-between border-t border-surface-200-700 px-6 py-4">
				<div>
					{#if currentStep > 1}
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium text-surface-600-300 transition-colors hover:bg-surface-100-800"
							onclick={prevStep}
						>
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
							</svg>
							Back
						</button>
					{:else}
						<span></span>
					{/if}
				</div>

				<div class="flex items-center gap-2">
					{#if currentStep === 4}
						<!-- Skip button for optional paper step -->
						<button
							type="button"
							class="rounded-lg px-4 py-2 text-sm font-medium text-surface-500-400 transition-colors hover:text-surface-900-50"
							onclick={nextStep}
						>
							Skip
						</button>
					{/if}

					{#if currentStep < TOTAL_STEPS}
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-lg bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
							onclick={nextStep}
						>
							Next
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					{:else if gated}
						<button
							type="button"
							class="rounded-lg bg-surface-300-600 px-6 py-2 text-sm font-medium text-surface-500-400 cursor-not-allowed"
							disabled
						>
							WebGPU Required
						</button>
					{:else}
						<button
							type="button"
							class="rounded-lg bg-primary-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
							onclick={handleFinish}
						>
							Start Demo
						</button>
					{/if}
				</div>
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
