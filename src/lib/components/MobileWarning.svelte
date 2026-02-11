<script lang="ts">
	/**
	 * MobileWarning - Shown when a mobile device is detected.
	 * Suggests using a desktop browser for the best experience.
	 */
</script>

<div class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
	<div class="flex items-start gap-3">
		<svg class="h-5 w-5 flex-shrink-0 text-warning-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
		</svg>
		<div>
			<h4 class="font-semibold text-warning-700 dark:text-warning-400">Mobile Device Detected</h4>
			<p class="mt-1 text-sm text-surface-700-200">
				Pixelwise uses WebGPU for real-time GPU computation, which has limited mobile support.
				For the best experience, use a desktop browser (Chrome 113+, Firefox 141+, or Safari 26+).
			</p>
			<p class="mt-2 text-xs text-surface-500-400">
				You can still continue - the demo will fall back to CPU-based processing.
			</p>
		</div>
	</div>
</div>
