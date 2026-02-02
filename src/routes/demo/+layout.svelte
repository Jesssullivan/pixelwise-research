<script lang="ts">
	import DemoSidebar from '$lib/components/demo-layout/DemoSidebar.svelte';
	import '../../app.css';

	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();
</script>

<div class="flex min-h-screen bg-surface-100-800 text-surface-900-50">
	<!-- Sidebar -->
	<DemoSidebar />

	<!-- Main Content Area -->
	<main class="flex-1 overflow-y-auto">
		{@render children()}
	</main>
</div>
