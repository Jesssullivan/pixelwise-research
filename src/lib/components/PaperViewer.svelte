<script lang="ts">
	/**
	 * PaperViewer - Embeds the research paper PDF or provides a download link.
	 *
	 * Uses <iframe> for desktop browsers, falls back to download link on mobile
	 * or when the PDF isn't available.
	 */

	import { browser } from '$app/environment';

	interface Props {
		/** Start collapsed */
		collapsed?: boolean;
		/** Max height for embedded viewer */
		maxHeight?: string;
	}

	let { collapsed = true, maxHeight = '50vh' }: Props = $props();

	const PDF_PATH = '/tex_research/pixelwise/dist/pixelwise.pdf';
	let expanded = $state(!collapsed);
	let pdfAvailable = $state<boolean | null>(null);

	// Check if PDF exists
	if (browser) {
		fetch(PDF_PATH, { method: 'HEAD' })
			.then(res => { pdfAvailable = res.ok; })
			.catch(() => { pdfAvailable = false; });
	}

	// Detect mobile for fallback to download link
	const isMobile = browser && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
</script>

<div class="rounded-lg border border-surface-300-600 bg-surface-50-900 overflow-hidden">
	<button
		type="button"
		class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-100-800 transition-colors"
		onclick={() => expanded = !expanded}
	>
		<div class="flex items-center gap-2">
			<svg class="h-5 w-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
			<span class="text-sm font-medium text-surface-900-50">Research Paper: ESDT + WCAG Pipeline</span>
		</div>
		<svg
			class="h-4 w-4 text-surface-500-400 transition-transform {expanded ? 'rotate-180' : ''}"
			fill="none" viewBox="0 0 24 24" stroke="currentColor"
		>
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
		</svg>
	</button>

	{#if expanded}
		<div class="border-t border-surface-200-700 p-4">
			{#if pdfAvailable === null}
				<div class="flex items-center gap-2 text-sm text-surface-500-400">
					<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Checking for paper...
				</div>
			{:else if pdfAvailable && !isMobile}
				<iframe
					src={PDF_PATH}
					title="Pixelwise Research Paper"
					class="w-full rounded border border-surface-200-700"
					style="height: {maxHeight};"
				></iframe>
				<div class="mt-2 flex justify-end">
					<a
						href={PDF_PATH}
						download="pixelwise-research-paper.pdf"
						class="text-xs text-primary-500 hover:underline"
					>
						Download PDF
					</a>
				</div>
			{:else if pdfAvailable}
				<div class="text-center space-y-3">
					<p class="text-sm text-surface-700-200">
						PDF viewer not available on mobile. Download the paper instead:
					</p>
					<a
						href={PDF_PATH}
						download="pixelwise-research-paper.pdf"
						class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
					>
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
						</svg>
						Download Paper (PDF)
					</a>
				</div>
			{:else}
				<div class="rounded-lg bg-surface-100-800 p-4 text-center">
					<p class="text-sm text-surface-500-400">
						Research paper not yet built.
					</p>
					<p class="mt-1 text-xs text-surface-500-400">
						Run <code class="font-mono bg-surface-200-700 px-1 rounded">just tex</code> to compile.
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
