<script lang="ts">
	interface Props {
		level: 'AA' | 'AAA' | 'fail';
		ratio: number;
		targetLevel?: 'AA' | 'AAA';
	}

	let { level, ratio, targetLevel = 'AA' }: Props = $props();

	const getBadgeColor = $derived(() => {
		if (level === 'AAA') return 'bg-success-500 text-white';
		if (level === 'AA') return 'bg-primary-500 text-white';
		return 'bg-error-500 text-white';
	});

	const getLabel = $derived(() => {
		if (level === 'AAA') return 'AAA';
		if (level === 'AA') return 'AA';
		return 'Fail';
	});

	const getRequiredRatio = $derived(() => {
		return targetLevel === 'AAA' ? 7.0 : 4.5;
	});
</script>

<div class="inline-flex items-center gap-2">
	<span
		class="px-2 py-1 rounded-md text-xs font-bold {getBadgeColor()}"
		role="status"
		aria-label="WCAG {getLabel()} - contrast ratio {ratio.toFixed(2)} to 1"
	>
		{getLabel()}
	</span>
	<span class="text-sm font-mono text-surface-700-200">
		{ratio.toFixed(2)}:1
	</span>
	{#if level === 'fail'}
		<span class="text-xs text-error-500">
			(needs {getRequiredRatio()}:1)
		</span>
	{/if}
</div>
