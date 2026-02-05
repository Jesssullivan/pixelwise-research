<script lang="ts">
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';

	const stats = [
		{ value: '6', label: 'Pipeline Stages', icon: 'lucide:layers', verified: true },
		{ value: 'ESDT', label: 'Distance Transform', icon: 'lucide:grid-3x3', verified: true },
		{ value: '30', label: 'Target FPS', icon: 'lucide:gauge', verified: true },
		{ value: 'Futhark', label: 'WASM Multicore', icon: 'lucide:zap', verified: true }
	];
</script>

<main class="min-h-screen bg-surface-50-900 text-surface-900-50">
	<!-- Hero Section -->
	<section class="relative overflow-hidden px-8 py-16 lg:py-24">
		<div class="max-w-6xl mx-auto">
			<div class="text-center mb-12" in:fade={{ duration: 600 }}>
				<h1 class="text-5xl lg:text-7xl font-bold mb-6 bg-gradient-to-r from-primary-500 to-secondary-500 text-transparent bg-clip-text">
					Pixelwise
				</h1>
				<p class="text-2xl lg:text-3xl text-surface-700-200 mb-4">
					ESDT-Based WCAG Compositing
				</p>
				<p class="text-lg lg:text-xl text-surface-600-300 max-w-3xl mx-auto mb-8">
					Exact Signed Distance Transform for CSS-independent accessibility remediation.
					Per-pixel contrast adjustment using verified WCAG 2.1 formulas with Futhark WASM multicore.
				</p>

				<!-- Stats Grid -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12 max-w-3xl mx-auto">
					{#each stats as stat}
						<div
							class="bg-surface-100-800/50 rounded-lg p-4 border {stat.verified
								? 'border-success-500/30'
								: 'border-warning-500/30'}"
						>
							<div class="flex items-center justify-center gap-2 mb-2">
								<Icon
									icon={stat.icon}
									width={20}
									class={stat.verified ? 'text-success-600-400' : 'text-warning-600-400'}
								/>
								<div class="text-2xl font-bold text-surface-900-50">{stat.value}</div>
							</div>
							<div class="text-xs text-surface-600-300">{stat.label}</div>
						</div>
					{/each}
				</div>

				<!-- CTA Buttons -->
				<div class="flex flex-wrap justify-center gap-4">
					<a
						href="/demo/compositor"
						class="btn preset-filled-primary-500 px-8 py-4 text-lg font-semibold cursor-pointer inline-flex items-center gap-2"
					>
						<Icon icon="lucide:play" width={20} />
						Launch Live Compositor
					</a>
					<a
						href="/tex_research/pixelwise/dist/pixelwise.pdf"
						class="btn preset-filled-secondary-500 px-8 py-4 text-lg font-semibold cursor-pointer"
						download="pixelwise-research-paper.pdf"
					>
						Download White Paper
					</a>
					<a
						href="https://github.com/tinyland/pixelwise"
						class="btn preset-tonal-surface px-8 py-4 text-lg font-semibold cursor-pointer"
						target="_blank"
						rel="noopener noreferrer"
					>
						View Source
					</a>
				</div>
			</div>
		</div>

		<!-- Decorative gradient orbs -->
		<div class="absolute top-0 left-1/4 w-96 h-96 bg-primary-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse pointer-events-none"></div>
		<div class="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary-500 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse delay-1000 pointer-events-none"></div>
	</section>

	<!-- Live Compositor Hero -->
	<section class="px-8 py-12 bg-surface-100-800/50">
		<div class="max-w-6xl mx-auto">
			<div
				class="bg-gradient-to-br from-success-500/20 to-primary-500/20 rounded-xl p-8 border border-success-500/50"
			>
				<div class="flex items-start gap-4 mb-6">
					<div
						class="w-12 h-12 rounded-full bg-success-500 text-white flex items-center justify-center"
					>
						<Icon icon="lucide:cpu" width={24} />
					</div>
					<div>
						<h2 class="text-2xl font-bold text-surface-900-50 flex items-center gap-3">
							Live ESDT Compositor
							<span class="px-2 py-1 text-xs bg-success-500 text-white rounded">FUTHARK WASM</span>
						</h2>
						<p class="text-surface-700-200 mt-2 max-w-2xl">
							Experience the Futhark WASM ESDT pipeline running on your content. Uses
							<code class="font-mono text-xs bg-surface-200-700 px-1 rounded">compute_esdt_2d()</code>
							for distance transform with WebGL2 overlay rendering.
						</p>
					</div>
				</div>

				<a
					href="/demo/compositor"
					class="btn preset-filled-primary-500 text-white inline-flex items-center gap-2 text-lg px-6 py-3"
				>
					<Icon icon="lucide:play" width={20} />
					Launch Live Compositor Demo
				</a>
			</div>
		</div>
	</section>

	<!-- 6-Stage Pipeline -->
	<section class="px-8 py-12">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-xl font-bold mb-4 text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:git-branch" width={24} />
				6-Stage ESDT Pipeline (Futhark WASM)
			</h2>

			<div class="bg-surface-50-900 rounded-lg border border-surface-300-600 overflow-hidden">
				<div class="grid grid-cols-1 md:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-surface-300-600">
					{#each [
						{ stage: 1, name: 'Grayscale', desc: 'Luminance convert', tech: 'Canvas2D' },
						{ stage: 2, name: 'X-Pass', desc: 'Horizontal ESDT', tech: 'Futhark WASM' },
						{ stage: 3, name: 'Y-Pass', desc: 'Vertical ESDT', tech: 'Futhark WASM' },
						{ stage: 4, name: 'Extract', desc: 'Glyph detection', tech: 'Distance threshold' },
						{ stage: 5, name: 'Sample', desc: 'Background color', tech: 'Gradient direction' },
						{ stage: 6, name: 'Adjust', desc: 'WCAG contrast', tech: 'Hue-preserving' }
					] as item}
						<div class="p-4 text-center">
							<div
								class="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center text-sm font-bold mx-auto mb-2"
							>
								{item.stage}
							</div>
							<div class="font-semibold text-surface-900-50 text-sm">{item.name}</div>
							<div class="text-xs text-surface-600-300">{item.desc}</div>
							<div class="text-xs text-primary-500 font-mono mt-1">{item.tech}</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<!-- Component Demos -->
	<section class="px-8 py-12 bg-surface-100-800/50">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-xl font-bold mb-4 text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:beaker" width={24} />
				Component Demos
			</h2>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<!-- Contrast Analysis -->
				<a
					href="/demo/contrast-analysis"
					class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-primary-500/50 transition-colors group"
				>
					<div class="flex items-center gap-3 mb-3">
						<div class="w-10 h-10 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center group-hover:bg-primary-500 group-hover:text-white transition-colors">
							<Icon icon="lucide:contrast" width={20} />
						</div>
						<div>
							<h3 class="font-semibold text-surface-900-50">Contrast Analysis</h3>
							<span class="text-xs font-mono text-primary-500">WCAG 2.1</span>
						</div>
					</div>
					<p class="text-sm text-surface-700-200">
						WCAG 2.1 contrast ratio calculation with proper sRGB gamma correction.
						Matches futhark/wcag.fut formula.
					</p>
				</a>

				<!-- Gradient Direction -->
				<a
					href="/demo/gradient-direction"
					class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-primary-500/50 transition-colors group"
				>
					<div class="flex items-center gap-3 mb-3">
						<div class="w-10 h-10 rounded-full bg-primary-500/20 text-primary-500 flex items-center justify-center group-hover:bg-primary-500 group-hover:text-white transition-colors">
							<Icon icon="lucide:compass" width={20} />
						</div>
						<div>
							<h3 class="font-semibold text-surface-900-50">ESDT Gradients</h3>
							<span class="text-xs font-mono text-primary-500">compute_esdt_2d()</span>
						</div>
					</div>
					<p class="text-sm text-surface-700-200">
						Extended Signed Distance Transform visualization using Futhark WASM
						with JS fallback.
					</p>
				</a>
			</div>
		</div>
	</section>

	<!-- Technical Specifications -->
	<section class="px-8 py-12">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-xl font-bold mb-4 text-surface-900-50 flex items-center gap-2">
				<Icon icon="lucide:file-code" width={24} />
				Verified Technical Specifications
			</h2>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600">
					<h3 class="font-semibold text-surface-900-50 mb-3 flex items-center gap-2">
						<Icon icon="lucide:check-circle" class="text-success-500" width={18} />
						WCAG 2.1 Compliance
					</h3>
					<ul class="space-y-2 text-sm text-surface-700-200">
						<li class="flex items-start gap-2">
							<span class="text-success-500 mt-1">-</span>
							<span>Linearization threshold: <code class="font-mono">0.03928</code> (not 0.04045)</span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success-500 mt-1">-</span>
							<span>Gamma exponent: <code class="font-mono">2.4</code></span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success-500 mt-1">-</span>
							<span>ITU-R BT.709: <code class="font-mono">0.2126R + 0.7152G + 0.0722B</code></span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success-500 mt-1">-</span>
							<span>Contrast ratio: <code class="font-mono">CR = (L1+0.05)/(L2+0.05)</code></span>
						</li>
					</ul>
				</div>

				<div class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600">
					<h3 class="font-semibold text-surface-900-50 mb-3 flex items-center gap-2">
						<Icon icon="lucide:zap" class="text-primary-500" width={18} />
						Futhark WASM Implementation
					</h3>
					<ul class="space-y-2 text-sm text-surface-700-200">
						<li class="flex items-start gap-2">
							<span class="text-primary-500 mt-1">-</span>
							<span>Edge weight: <code class="font-mono">w = 4a(1-a)</code>, peaks at a=0.5</span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-primary-500 mt-1">-</span>
							<span>Backend: <code class="font-mono">Futhark WASM multicore</code></span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-primary-500 mt-1">-</span>
							<span>ESDT: <code class="font-mono">O(n)</code> separable 2D passes</span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-primary-500 mt-1">-</span>
							<span>Source: <code class="font-mono">futhark/esdt.fut</code>, <code class="font-mono">futhark/wcag.fut</code></span>
						</li>
					</ul>
				</div>
			</div>
		</div>
	</section>

	<!-- Mathematical Foundations Section -->
	<section class="px-8 py-12 bg-surface-100-800/50">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-3xl lg:text-4xl font-bold text-center mb-4 text-surface-900-50">
				Mathematical Foundations
			</h2>
			<p class="text-center text-surface-600-300 mb-12 max-w-2xl mx-auto">
				Verified algorithms with property-based tests at threshold boundaries
			</p>

			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				<div class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-primary-500 transition-colors">
					<div class="flex items-center gap-2 mb-4">
						<span class="text-primary-500 text-2xl font-mono">d</span>
						<span class="px-2 py-0.5 text-xs bg-success-500/20 text-success-500 rounded">Verified</span>
					</div>
					<h3 class="text-lg font-semibold mb-2 text-surface-900-50">ESDT Gradient</h3>
					<p class="text-sm text-surface-700-200">
						Offset vectors encode distance and direction to nearest edge.
						Gray pixel initialization: offset = L - 0.5
					</p>
				</div>

				<div class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-secondary-500 transition-colors">
					<div class="flex items-center gap-2 mb-4">
						<span class="text-secondary-500 text-2xl font-mono">L</span>
						<span class="px-2 py-0.5 text-xs bg-success-500/20 text-success-500 rounded">70+ Tests</span>
					</div>
					<h3 class="text-lg font-semibold mb-2 text-surface-900-50">Relative Luminance</h3>
					<p class="text-sm text-surface-700-200">
						L = 0.2126R + 0.7152G + 0.0722B with correct threshold (0.03928) and gamma (2.4)
					</p>
				</div>

				<div class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-success-500 transition-colors">
					<div class="flex items-center gap-2 mb-4">
						<span class="text-success-500 text-2xl font-mono">CR</span>
						<span class="px-2 py-0.5 text-xs bg-success-500/20 text-success-500 rounded">Verified</span>
					</div>
					<h3 class="text-lg font-semibold mb-2 text-surface-900-50">Contrast Ratio</h3>
					<p class="text-sm text-surface-700-200">
						CR = (L1 + 0.05)/(L2 + 0.05) where CR is in range [1, 21]. Black/white verified at ~21:1
					</p>
				</div>

				<div class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-warning-500 transition-colors">
					<div class="flex items-center gap-2 mb-4">
						<span class="text-warning-500 text-2xl font-mono">w</span>
						<span class="px-2 py-0.5 text-xs bg-success-500/20 text-success-500 rounded">Verified</span>
					</div>
					<h3 class="text-lg font-semibold mb-2 text-surface-900-50">Edge Weight</h3>
					<p class="text-sm text-surface-700-200">
						w = 4a(1-a) peaks at a=0.5, providing natural contrast emphasis at glyph boundaries
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Implementation Status -->
	<section class="px-8 py-12">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-3xl lg:text-4xl font-bold text-center mb-4 text-surface-900-50">
				Implementation Status
			</h2>
			<p class="text-center text-surface-600-300 mb-12 max-w-2xl mx-auto">
				Current progress on core components and features
			</p>

			<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
				<div class="bg-surface-100-800 rounded-lg p-8 border border-success-500/30">
					<h3 class="text-2xl font-semibold mb-6 text-success-500">Completed</h3>
					<ul class="space-y-3 text-surface-700-200">
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">21</span>
							<span>WCAG contrast property-based tests</span>
						</li>
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">3</span>
							<span>Futhark WASM modules (ESDT, WCAG, Pipeline)</span>
						</li>
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">9</span>
							<span>WGSL compute shaders for 6-pass pipeline</span>
						</li>
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">7</span>
							<span>WebGPU compute pipelines fully wired</span>
						</li>
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">21:1</span>
							<span>Black/white contrast ratio verified at boundaries</span>
						</li>
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">7x7</span>
							<span>Gaussian kernel background sampling</span>
						</li>
						<li class="flex items-start">
							<span class="text-success-500 mr-3 font-mono text-sm">0</span>
							<span>DOM modifications (CSS-independent approach)</span>
						</li>
					</ul>
				</div>

				<div class="bg-surface-100-800 rounded-lg p-8 border border-warning-500/30">
					<h3 class="text-2xl font-semibold mb-6 text-warning-500">Roadmap</h3>
					<ul class="space-y-3 text-surface-700-200">
						<li class="flex items-start">
							<span class="text-warning-500 mr-3 font-mono text-sm">~</span>
							<span>Publish live demo (pixelwise.ephemera.xoxd.ai)</span>
						</li>
						<li class="flex items-start">
							<span class="text-warning-500 mr-3 font-mono text-sm">~</span>
							<span>Improve transparency handling (FloatingUI integration)</span>
						</li>
						<li class="flex items-start">
							<span class="text-warning-500 mr-3 font-mono text-sm">~</span>
							<span>Memory management with greedy viewport offloading</span>
						</li>
						<li class="flex items-start">
							<span class="text-warning-500 mr-3 font-mono text-sm">~</span>
							<span>Multi-architecture GPU demos</span>
						</li>
					</ul>
				</div>
			</div>
		</div>
	</section>

	<!-- Documentation -->
	<section class="px-8 py-12 bg-surface-100-800/50">
		<div class="max-w-6xl mx-auto">
			<h2 class="text-3xl lg:text-4xl font-bold text-center mb-4 text-surface-900-50">
				Documentation
			</h2>
			<p class="text-center text-surface-600-300 mb-12 max-w-2xl mx-auto">
				Technical resources and verification status
			</p>

			<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
				<a
					href="/tex_research/pixelwise/dist/pixelwise.pdf"
					class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-primary-500 transition-all transform hover:scale-105 cursor-pointer"
					download="pixelwise-research-paper.pdf"
				>
					<h3 class="text-xl font-semibold mb-3 text-primary-500">
						Research Paper (PDF)
					</h3>
					<p class="text-surface-700-200 text-sm">
						Full technical specification with mathematical proofs and algorithm details
					</p>
				</a>

				<a
					href="/demo"
					class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-secondary-500 transition-all transform hover:scale-105 cursor-pointer"
				>
					<h3 class="text-xl font-semibold mb-3 text-secondary-500">
						Interactive Demos
					</h3>
					<p class="text-surface-700-200 text-sm">
						Live demonstrations of the ESDT pipeline, contrast analysis, and gradient visualization
					</p>
				</a>

				<a
					href="https://github.com/tinyland/pixelwise"
					class="bg-surface-50-900 rounded-lg p-6 border border-surface-300-600 hover:border-success-500 transition-all transform hover:scale-105 cursor-pointer"
					target="_blank"
					rel="noopener noreferrer"
				>
					<h3 class="text-xl font-semibold mb-3 text-success-500">
						Source Code
					</h3>
					<p class="text-surface-700-200 text-sm">
						Full source including Futhark WASM, WGSL shaders, and test suites
					</p>
				</a>
			</div>
		</div>
	</section>

	<!-- Call to Action -->
	<section class="px-8 py-16">
		<div class="max-w-4xl mx-auto bg-surface-50-900 rounded-lg p-8 border border-surface-300-600">
			<h2 class="text-xl font-bold mb-4 text-surface-900-50">Get Started</h2>
			<p class="text-surface-700-200 mb-6">
				Launch the live compositor demo to see the Futhark WASM ESDT pipeline in action. Download the
				research paper for detailed mathematical foundations and verification status.
			</p>
			<div class="flex flex-wrap gap-3">
				<a
					href="/demo/compositor"
					class="btn preset-filled-primary-500 text-white inline-flex items-center gap-2"
				>
					<Icon icon="lucide:play" width={18} />
					Live Compositor Demo
				</a>
				<a
					href="/tex_research/pixelwise/dist/pixelwise.pdf"
					class="btn preset-filled-secondary-500 text-white inline-flex items-center gap-2"
					download="pixelwise-research-paper.pdf"
				>
					<Icon icon="lucide:file-text" width={18} />
					Download White Paper
				</a>
				<a
					href="https://github.com/tinyland/pixelwise"
					class="btn preset-tonal-surface inline-flex items-center gap-2"
					target="_blank"
					rel="noopener noreferrer"
				>
					<Icon icon="lucide:github" width={18} />
					View Source
				</a>
			</div>
		</div>
	</section>

</main>
