<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '@iconify/svelte';

	const navItems = [
		{ href: '/demo', label: 'Overview', icon: 'lucide:home' },
		{ href: '/demo/compositor', label: 'Live Compositor', icon: 'lucide:layers' },
		{ href: '/demo/contrast-analysis', label: 'Contrast Analysis', icon: 'lucide:contrast' },
		{ href: '/demo/gradient-direction', label: 'Gradient Direction', icon: 'lucide:compass' },
		{ href: '/demo/performance', label: 'Performance', icon: 'lucide:gauge' },
		{ href: '/demo/before-after', label: 'Before / After', icon: 'lucide:columns-2' }
	];

	const pipelineStages = [
		'1. Grayscale: Luminance conversion',
		'2. X-Pass: Horizontal ESDT',
		'3. Y-Pass: Vertical ESDT',
		'4. Extract: Glyph detection',
		'5. Sample: Background color',
		'6. Adjust: WCAG contrast'
	];

	// Reactive check for active route
	const currentPath = $derived($page.url.pathname);
</script>

<aside class="w-64 bg-surface-50-900 border-r border-surface-300-600 p-6 overflow-y-auto">
	<!-- Logo / Title -->
	<div class="mb-8">
		<h2 class="text-xl font-bold text-surface-900-50 mb-1">Pixelwise</h2>
		<p class="text-xs text-surface-600-300">ESDT Pipeline Demos</p>
	</div>

	<!-- Navigation -->
	<nav class="space-y-1 mb-8">
		{#each navItems as item}
			<a
				href={item.href}
				class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
				       {currentPath === item.href
				       	? 'bg-primary-500 text-white font-medium'
				       	: 'text-surface-700-200 hover:bg-surface-200-700'}"
			>
				<Icon icon={item.icon} width={18} />
				<span>{item.label}</span>
			</a>
		{/each}
	</nav>

	<!-- Pipeline Overview -->
	<div class="border-t border-surface-300-600 pt-6">
		<h3 class="text-xs font-semibold uppercase tracking-wider text-surface-600-300 mb-3">
			ESDT Pipeline
		</h3>
		<div class="space-y-2">
			{#each pipelineStages as stage, i}
				<div class="flex items-start gap-2">
					<span
						class="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100-900 text-primary-700-300 flex items-center justify-center text-xs font-medium"
					>
						{i + 1}
					</span>
					<p class="text-xs text-surface-700-200 leading-tight">{stage}</p>
				</div>
			{/each}
		</div>

		<!-- Pipeline Diagram -->
		<svg viewBox="0 0 200 120" class="w-full mt-4" aria-label="ESDT pipeline diagram">
			<!-- Extract -->
			<rect x="10" y="10" width="40" height="20" fill="currentColor" class="text-primary-500" rx="4" />
			<text x="30" y="24" text-anchor="middle" class="fill-white text-xs font-medium">E</text>

			<!-- Arrow -->
			<path d="M 55 20 L 65 20" stroke="currentColor" class="stroke-surface-400" stroke-width="2" />
			<path d="M 62 17 L 65 20 L 62 23" stroke="currentColor" class="stroke-surface-400" stroke-width="2" fill="none" />

			<!-- Sample -->
			<rect x="70" y="10" width="40" height="20" fill="currentColor" class="text-secondary-500" rx="4" />
			<text x="90" y="24" text-anchor="middle" class="fill-white text-xs font-medium">S</text>

			<!-- Arrow -->
			<path d="M 115 20 L 125 20" stroke="currentColor" class="stroke-surface-400" stroke-width="2" />
			<path d="M 122 17 L 125 20 L 122 23" stroke="currentColor" class="stroke-surface-400" stroke-width="2" fill="none" />

			<!-- Detect -->
			<rect x="130" y="10" width="40" height="20" fill="currentColor" class="text-tertiary-500" rx="4" />
			<text x="150" y="24" text-anchor="middle" class="fill-white text-xs font-medium">D</text>

			<!-- Arrow down -->
			<path d="M 150 35 L 150 45" stroke="currentColor" class="stroke-surface-400" stroke-width="2" />
			<path d="M 147 42 L 150 45 L 153 42" stroke="currentColor" class="stroke-surface-400" stroke-width="2" fill="none" />

			<!-- Transform -->
			<rect x="130" y="50" width="40" height="20" fill="currentColor" class="text-warning-500" rx="4" />
			<text x="150" y="64" text-anchor="middle" class="fill-white text-xs font-medium">T</text>

			<!-- Arrow back -->
			<path d="M 125 60 L 55 60" stroke="currentColor" class="stroke-surface-400" stroke-width="2" />
			<path d="M 58 57 L 55 60 L 58 63" stroke="currentColor" class="stroke-surface-400" stroke-width="2" fill="none" />

			<!-- GPU Output -->
			<rect x="10" y="50" width="40" height="20" fill="currentColor" class="text-success-500" rx="4" />
			<text x="30" y="64" text-anchor="middle" class="fill-white text-xs font-medium">GPU</text>

			<!-- Labels -->
			<text x="100" y="95" text-anchor="middle" class="fill-surface-600-300 text-[10px]">Futhark WASM Pipeline</text>
			<text x="100" y="108" text-anchor="middle" class="fill-surface-600-300 text-[8px]">6-pass ESDT + WCAG</text>
		</svg>
	</div>

	<!-- Tech Stack -->
	<div class="border-t border-surface-300-600 pt-6 mt-6">
		<h3 class="text-xs font-semibold uppercase tracking-wider text-surface-600-300 mb-3">
			Tech Stack
		</h3>
		<div class="flex flex-wrap gap-2">
			{#each ['Futhark', 'WASM', 'WebGPU', 'Svelte 5'] as tech}
				<span class="badge preset-tonal-primary text-xs text-primary-700-300">{tech}</span>
			{/each}
		</div>
	</div>
</aside>
