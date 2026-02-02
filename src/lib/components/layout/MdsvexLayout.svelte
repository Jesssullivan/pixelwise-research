<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		date?: string;
		excerpt?: string;
		coverImage?: string;
		author?:
			| string
			| {
					name?: string;
					handle?: string;
					avatar?: string;
			  };
		tags?: string[];
		categories?: string[];
		children: Snippet;
		[key: string]: unknown;
	}

	let { title, date, excerpt, coverImage, author, tags, categories, children, ...rest }: Props =
		$props();

	// Extract author name if author is an object
	const authorName = typeof author === 'object' && author ? author.name : (author as string);

	// Format date for display
	function formatDate(dateString: string): string {
		if (!dateString) return '';
		try {
			return new Date(dateString).toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return dateString;
		}
	}
</script>

<article
	class="prose prose-lg dark:prose-invert prose-headings:scroll-mt-20 mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8"
>
	<header class="mb-8">
		{#if coverImage}
			<img
				src={coverImage}
				alt={title || 'Article cover'}
				class="mb-6 h-64 w-full rounded-lg object-cover"
			/>
		{/if}

		{#if title}
			<h1 class="mb-4 text-3xl font-bold md:text-4xl">
				{title}
			</h1>
		{/if}

		{#if excerpt}
			<p class="mb-4 text-lg text-surface-600 dark:text-surface-300">
				{excerpt}
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-4 text-sm text-surface-500 dark:text-surface-400">
			{#if authorName}
				<span>By {authorName}</span>
			{/if}

			{#if date}
				<time datetime={date}>
					{formatDate(date)}
				</time>
			{/if}
		</div>

		{#if categories && categories.length > 0}
			<div class="mt-4 flex flex-wrap gap-2">
				{#each categories as category}
					<span
						class="rounded-full bg-primary-100 px-3 py-1 text-xs text-primary-800 dark:bg-primary-900 dark:text-primary-200"
					>
						{category}
					</span>
				{/each}
			</div>
		{/if}

		{#if tags && tags.length > 0}
			<div class="mt-2 flex flex-wrap gap-2">
				{#each tags as tag}
					<span
						class="rounded bg-surface-100 px-2 py-1 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-300"
					>
						#{tag}
					</span>
				{/each}
			</div>
		{/if}
	</header>

	<div class="prose-content leading-relaxed">
		{@render children()}
	</div>
</article>
