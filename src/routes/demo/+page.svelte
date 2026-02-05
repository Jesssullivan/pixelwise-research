<script lang="ts">
	import DemoHeader from '$lib/components/demo-layout/DemoHeader.svelte';
	import Icon from '@iconify/svelte';

	const demos = [
		{
			href: '/demo/compositor',
			title: 'Live Compositor',
			description: 'Real-time ESDT contrast enhancement with Screen Capture API',
			icon: 'lucide:layers',
			tags: ['WebGPU', 'Futhark', 'WCAG']
		},
		{
			href: '/demo/contrast-analysis',
			title: 'Contrast Analysis',
			description: 'WCAG 2.1 contrast ratio calculator and color adjustment tools',
			icon: 'lucide:contrast',
			tags: ['WCAG', 'Colors']
		},
		{
			href: '/demo/gradient-direction',
			title: 'Gradient Direction',
			description: 'Visualize ESDT offset vectors and background sampling direction',
			icon: 'lucide:compass',
			tags: ['ESDT', 'Visualization']
		},
		{
			href: '/demo/performance',
			title: 'Performance Metrics',
			description: 'Pipeline timing, GPU utilization, and frame statistics',
			icon: 'lucide:gauge',
			tags: ['Metrics', 'Debug']
		},
		{
			href: '/demo/before-after',
			title: 'Before/After',
			description: 'Side-by-side comparison of original and enhanced content',
			icon: 'lucide:columns-2',
			tags: ['Comparison']
		}
	];

	const pipelineSteps = [
		{ name: 'Grayscale', desc: 'Luminance conversion (Y = 0.2126R + 0.7152G + 0.0722B)' },
		{ name: 'X-Pass ESDT', desc: 'Horizontal distance propagation with offset vectors' },
		{ name: 'Y-Pass ESDT', desc: 'Vertical distance propagation completing 2D transform' },
		{ name: 'Glyph Extract', desc: 'Threshold distance field to identify text pixels' },
		{ name: 'BG Sample', desc: 'Sample background color along gradient direction' },
		{ name: 'WCAG Adjust', desc: 'Apply contrast correction preserving hue' }
	];
</script>

<DemoHeader
	title="Pixelwise Demos"
	description="Interactive demonstrations of the ESDT pipeline and WCAG contrast enhancement"
/>

<div class="p-8 max-w-6xl mx-auto">
	<!-- Hero Section -->
	<section class="mb-12 text-center">
		<h1 class="text-3xl font-bold text-surface-900-50 mb-4">
			Real-Time WCAG Contrast Enhancement
		</h1>
		<p class="text-lg text-surface-600-300 max-w-2xl mx-auto">
			Explore the Extended Signed Distance Transform (ESDT) algorithm implemented in
			WebGPU and Futhark WASM for real-time, per-pixel accessibility correction.
		</p>
	</section>

	<!-- Demo Cards -->
	<section class="mb-12">
		<h2 class="text-xl font-semibold text-surface-900-50 mb-6 flex items-center gap-2">
			<Icon icon="lucide:play-circle" width={24} />
			Interactive Demos
		</h2>

		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each demos as demo}
				<a
					href={demo.href}
					class="group block rounded-xl border border-surface-300-600 bg-surface-50-900 p-6 transition-all hover:border-primary-500 hover:shadow-lg"
				>
					<div class="flex items-start gap-4">
						<div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white">
							<Icon icon={demo.icon} width={24} />
						</div>
						<div class="flex-1">
							<h3 class="font-semibold text-surface-900-50 group-hover:text-primary-500">
								{demo.title}
							</h3>
							<p class="mt-1 text-sm text-surface-600-300">
								{demo.description}
							</p>
							<div class="mt-3 flex flex-wrap gap-2">
								{#each demo.tags as tag}
									<span class="rounded-full bg-surface-200-700 px-2 py-0.5 text-xs text-surface-600-300">
										{tag}
									</span>
								{/each}
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	</section>

	<!-- Pipeline Overview -->
	<section class="mb-12 rounded-xl border border-surface-300-600 bg-surface-50-900 p-6">
		<h2 class="text-xl font-semibold text-surface-900-50 mb-6 flex items-center gap-2">
			<Icon icon="lucide:workflow" width={24} />
			6-Pass ESDT Pipeline
		</h2>

		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each pipelineSteps as step, i}
				<div class="flex items-start gap-3 rounded-lg bg-surface-100-800 p-4">
					<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
						{i + 1}
					</div>
					<div>
						<h4 class="font-medium text-surface-900-50">{step.name}</h4>
						<p class="mt-1 text-xs text-surface-600-300">{step.desc}</p>
					</div>
				</div>
			{/each}
		</div>

		<div class="mt-6 pt-6 border-t border-surface-300-600">
			<p class="text-sm text-surface-600-300">
				The pipeline processes screen captures in real-time, identifying text pixels via ESDT,
				sampling background colors along the gradient direction, and applying WCAG-compliant
				contrast adjustments while preserving the original hue.
			</p>
		</div>
	</section>

	<!-- Tech Stack -->
	<section class="rounded-xl border border-primary-500/30 bg-primary-500/5 p-6">
		<h2 class="text-xl font-semibold text-primary-500 mb-4 flex items-center gap-2">
			<Icon icon="lucide:cpu" width={24} />
			Technology Stack
		</h2>

		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div class="text-center">
				<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-100-800">
					<Icon icon="simple-icons:webgpu" width={28} class="text-surface-900-50" />
				</div>
				<h4 class="font-medium text-surface-900-50">WebGPU</h4>
				<p class="text-xs text-surface-600-300">GPU compute shaders</p>
			</div>

			<div class="text-center">
				<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-100-800">
					<Icon icon="simple-icons:webassembly" width={28} class="text-surface-900-50" />
				</div>
				<h4 class="font-medium text-surface-900-50">Futhark WASM</h4>
				<p class="text-xs text-surface-600-300">Multicore via pthreads</p>
			</div>

			<div class="text-center">
				<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-100-800">
					<Icon icon="simple-icons:svelte" width={28} class="text-surface-900-50" />
				</div>
				<h4 class="font-medium text-surface-900-50">Svelte 5</h4>
				<p class="text-xs text-surface-600-300">Runes + signals</p>
			</div>

			<div class="text-center">
				<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-100-800">
					<Icon icon="lucide:accessibility" width={28} class="text-surface-900-50" />
				</div>
				<h4 class="font-medium text-surface-900-50">WCAG 2.1</h4>
				<p class="text-xs text-surface-600-300">AA/AAA compliance</p>
			</div>
		</div>
	</section>
</div>
