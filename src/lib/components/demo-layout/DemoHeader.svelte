<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '@iconify/svelte';

	interface Props {
		title?: string;
		description?: string;
	}

	let { title = '', description = '' }: Props = $props();

	// Generate breadcrumbs from current path
	const breadcrumbs = $derived.by(() => {
		const path = $page.url.pathname;
		const segments = path.split('/').filter(Boolean);

		return segments.map((segment, index) => {
			const href = '/' + segments.slice(0, index + 1).join('/');
			const label = segment
				.split('-')
				.map(word => word.charAt(0).toUpperCase() + word.slice(1))
				.join(' ');

			return { href, label };
		});
	});
</script>

<header class="bg-surface-50-900 border-b border-surface-300-600 px-8 py-6">
	<!-- Breadcrumbs -->
	<nav class="flex items-center gap-2 text-sm mb-3" aria-label="Breadcrumb">
		<a href="/" class="text-surface-600-300 hover:text-surface-900-50 transition-colors">
			<Icon icon="lucide:home" width={16} />
		</a>

		{#each breadcrumbs as crumb, i}
			<Icon icon="lucide:chevron-right" width={14} class="text-surface-400" />
			{#if i === breadcrumbs.length - 1}
				<span class="text-surface-900-50 font-medium" aria-current="page">{crumb.label}</span>
			{:else}
				<a href={crumb.href} class="text-surface-600-300 hover:text-surface-900-50 transition-colors">
					{crumb.label}
				</a>
			{/if}
		{/each}
	</nav>

	<!-- Title and Description -->
	{#if title}
		<h1 class="text-3xl font-bold text-surface-900-50 mb-2">{title}</h1>
	{/if}
	{#if description}
		<p class="text-surface-600-300 max-w-3xl">{description}</p>
	{/if}
</header>
