<script lang="ts">
	import { browser } from '$app/environment';
	import { parseBrowserInfo, type BrowserInfo } from '$lib/pixelwise/browserSupport';
	import { getCapabilities, type FeatureCapabilities } from '$lib/pixelwise/featureDetection';
	import type { WebGPUStatus } from '$lib/composables/useWebGPUStatus.svelte';

	interface Props {
		/**
		 * Feature capabilities object. Can be passed from useWebGPUStatus().capabilities
		 * or will fall back to sync detection if not provided.
		 */
		capabilities?: FeatureCapabilities;
		/** Show compact version of instructions */
		compact?: boolean;
		/** Callback to trigger re-detection */
		onRecheck?: () => void;
	}

	let { capabilities = undefined, compact = false, onRecheck }: Props = $props();

	let copiedText = $state('');

	// Get browser info and capabilities
	const browserInfo: BrowserInfo = $derived.by(() => {
		if (!browser) {
			return { name: 'Unknown', version: '0', fullVersion: '0.0.0', os: 'Unknown', isMobile: false };
		}
		return parseBrowserInfo();
	});

	const caps: FeatureCapabilities = $derived.by(() => {
		return capabilities ?? getCapabilities();
	});

	// Determine what instructions to show
	const needsInstructions = $derived.by(() => {
		if (!browser) return false;
		return !caps.webgpu;
	});

	const isFirefoxLinux = $derived.by(() => {
		return browserInfo.name === 'Firefox' && browserInfo.os === 'Linux';
	});

	const isFirefoxWindows = $derived.by(() => {
		return browserInfo.name === 'Firefox' && browserInfo.os === 'Windows';
	});

	const isChromeLinux = $derived.by(() => {
		return browserInfo.name === 'Chrome' && browserInfo.os === 'Linux';
	});

	const isSafari = $derived.by(() => {
		return browserInfo.name === 'Safari';
	});

	const isOldBrowser = $derived.by(() => {
		const version = parseInt(browserInfo.version, 10);
		if (browserInfo.name === 'Chrome' && version < 113) return true;
		if (browserInfo.name === 'Edge' && version < 113) return true;
		if (browserInfo.name === 'Firefox' && version < 141) return true;
		if (browserInfo.name === 'Safari' && version < 17) return true;
		return false;
	});

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedText = text;
			setTimeout(() => { copiedText = ''; }, 2000);
		} catch {
			// Fallback: select text
		}
	}
</script>

{#if caps.webgpu}
	<!-- WebGPU Available -->
	<div class="flex items-center gap-2 rounded-lg bg-success-500/10 p-3 text-success-700 dark:text-success-400">
		<svg class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
		</svg>
		<span class="text-sm font-medium">WebGPU is enabled</span>
		{#if caps.webgpuAdapter && !compact}
			<span class="text-xs opacity-75">({caps.webgpuAdapter})</span>
		{/if}
	</div>
{:else if isFirefoxLinux}
	<!-- Firefox on Linux -->
	<div class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
		<h4 class="mb-2 flex items-center gap-2 font-semibold text-warning-700 dark:text-warning-400">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			Enable WebGPU in Firefox
		</h4>
		{#if !compact}
			<ol class="ml-6 list-decimal space-y-1 text-sm text-surface-700-200">
				<li>Navigate to <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">about:config</code></li>
				<li>Set <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">dom.webgpu.enabled</code> to <code class="rounded bg-success-500/20 px-1 py-0.5 font-mono text-xs text-success-700 dark:text-success-400">true</code></li>
				<li>Set <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">gfx.webgpu.ignore-blocklist</code> to <code class="rounded bg-success-500/20 px-1 py-0.5 font-mono text-xs text-success-700 dark:text-success-400">true</code></li>
				<li>Restart Firefox</li>
			</ol>
		{:else}
			<p class="text-sm text-surface-700-200">
				Enable in <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">about:config</code>: <code class="font-mono text-xs">dom.webgpu.enabled</code>
			</p>
		{/if}
	</div>
{:else if isFirefoxWindows}
	<!-- Firefox on Windows (should work by default in 141+) -->
	<div class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
		<h4 class="mb-2 flex items-center gap-2 font-semibold text-warning-700 dark:text-warning-400">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			WebGPU may need enabling
		</h4>
		{#if !compact}
			<p class="mb-2 text-sm text-surface-700-200">
				Firefox {browserInfo.version} on Windows should support WebGPU by default. If not working:
			</p>
			<ol class="ml-6 list-decimal space-y-1 text-sm text-surface-700-200">
				<li>Navigate to <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">about:config</code></li>
				<li>Set <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">dom.webgpu.enabled</code> to <code class="rounded bg-success-500/20 px-1 py-0.5 font-mono text-xs text-success-700 dark:text-success-400">true</code></li>
				<li>Restart Firefox</li>
			</ol>
		{:else}
			<p class="text-sm text-surface-700-200">
				Try enabling in <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">about:config</code>
			</p>
		{/if}
	</div>
{:else if isChromeLinux}
	<!-- Chrome on Linux -->
	<div class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
		<h4 class="mb-2 flex items-center gap-2 font-semibold text-warning-700 dark:text-warning-400">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			Enable WebGPU in Chrome
		</h4>
		{#if !compact}
			<p class="mb-2 text-sm text-surface-700-200">
				Launch Chrome with the WebGPU flag:
			</p>
			<div class="relative">
				<code class="block rounded bg-surface-200-700 p-2 pr-10 font-mono text-xs">
					google-chrome --enable-unsafe-webgpu
				</code>
				<button
					type="button"
					class="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500-400 hover:text-primary-500 transition-colors"
					onclick={() => copyToClipboard('google-chrome --enable-unsafe-webgpu')}
					title="Copy to clipboard"
				>
					{#if copiedText === 'google-chrome --enable-unsafe-webgpu'}
						<svg class="h-4 w-4 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
					{:else}
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
						</svg>
					{/if}
				</button>
			</div>
			<p class="mt-2 text-xs text-surface-500-400">
				Or enable via <code class="font-mono">chrome://flags/#enable-unsafe-webgpu</code>
			</p>
		{:else}
			<p class="text-sm text-surface-700-200">
				Launch with <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">--enable-unsafe-webgpu</code>
			</p>
		{/if}
	</div>
{:else if isSafari}
	<!-- Safari Instructions -->
	<div class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
		<h4 class="mb-2 flex items-center gap-2 font-semibold text-warning-700 dark:text-warning-400">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			Enable WebGPU in Safari
		</h4>
		{#if !compact}
			{@const safariVersion = parseInt(browserInfo.version, 10)}
			{#if safariVersion >= 26}
				<p class="text-sm text-surface-700-200">
					Safari 26+ has WebGPU enabled by default. If it's not working, check:
				</p>
				<ol class="ml-6 mt-2 list-decimal space-y-1 text-sm text-surface-700-200">
					<li>Develop menu > Feature Flags > WebGPU is enabled</li>
					<li>Your GPU is not blocklisted (check Safari > About)</li>
				</ol>
			{:else if safariVersion >= 17}
				<p class="mb-2 text-sm text-surface-700-200">
					Safari {browserInfo.version} supports WebGPU via Feature Flags:
				</p>
				<ol class="ml-6 list-decimal space-y-1 text-sm text-surface-700-200">
					<li>Open Safari Preferences > Advanced</li>
					<li>Enable "Show features for web developers"</li>
					<li>Go to Develop > Feature Flags</li>
					<li>Enable <code class="rounded bg-surface-200-700 px-1 py-0.5 font-mono text-xs">WebGPU</code></li>
					<li>Restart Safari</li>
				</ol>
			{:else}
				<p class="text-sm text-surface-700-200">
					Safari {browserInfo.version} does not support WebGPU. Update to Safari 17+ (Feature Flags) or Safari 26+ (default).
				</p>
			{/if}
		{:else}
			<p class="text-sm text-surface-700-200">
				Enable via Develop > Feature Flags > WebGPU
			</p>
		{/if}
	</div>
{:else if isOldBrowser}
	<!-- Outdated browser version -->
	<div class="rounded-lg border border-error-500/30 bg-error-500/10 p-4">
		<h4 class="mb-2 flex items-center gap-2 font-semibold text-error-700 dark:text-error-400">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
			Browser Update Required
		</h4>
		{#if !compact}
			<p class="text-sm text-surface-700-200">
				{browserInfo.name} {browserInfo.version} does not support WebGPU.
			</p>
			<p class="mt-2 text-sm text-surface-700-200">
				Please update to:
			</p>
			<ul class="ml-6 mt-1 list-disc text-sm text-surface-700-200">
				<li>Chrome 113+</li>
				<li>Edge 113+</li>
				<li>Firefox 141+ (Windows default, Linux via flags)</li>
				<li>Safari 26+ (macOS/iOS)</li>
			</ul>
		{:else}
			<p class="text-sm text-surface-700-200">
				Update {browserInfo.name} for WebGPU support
			</p>
		{/if}
	</div>
{:else}
	<!-- Generic WebGPU unavailable -->
	<div class="rounded-lg border border-error-500/30 bg-error-500/10 p-4">
		<h4 class="mb-2 flex items-center gap-2 font-semibold text-error-700 dark:text-error-400">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
			WebGPU Not Available
		</h4>
		{#if !compact}
			<p class="mb-2 text-sm text-surface-700-200">
				Falling back to Futhark WASM (CPU). For best performance:
			</p>
			<ul class="ml-6 list-disc text-sm text-surface-700-200">
				<li>Use Chrome 113+, Edge 113+, or Firefox 141+</li>
				<li>Ensure you're on HTTPS or localhost</li>
				<li>Check that your GPU isn't blocklisted</li>
			</ul>
			{#if caps.sharedArrayBuffer}
				<p class="mt-2 text-xs text-surface-500-400">
					SharedArrayBuffer available - using WASM multicore fallback
				</p>
			{/if}
		{:else}
			<p class="text-sm text-surface-700-200">
				Using CPU fallback. Try Chrome 113+ for GPU acceleration.
			</p>
		{/if}
	</div>
{/if}

{#if !caps.webgpu && onRecheck && !compact}
	<div class="mt-3 flex justify-center">
		<button
			type="button"
			class="inline-flex items-center gap-2 rounded-lg border border-primary-500 px-4 py-2 text-sm font-medium text-primary-500 transition-colors hover:bg-primary-500 hover:text-white"
			onclick={onRecheck}
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
			Re-check WebGPU
		</button>
	</div>
{/if}
