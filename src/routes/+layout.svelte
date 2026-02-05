<script lang="ts">
	import '../app.css';
	// Skeleton color utilities - import via JS (not CSS @import)
	// Generated on-demand by Vite plugin
	import 'virtual:skeleton-colors';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import OnboardingModal from '$lib/components/OnboardingModal.svelte';
	import { shouldShowOnboarding } from '$lib/utils/consentStorage';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	// Theme state
	let currentTheme = $state('cerberus');
	let isDark = $state(false);
	let mobileMenuOpen = $state(false);
	let initialized = $state(false);

	// Onboarding modal state
	let showOnboarding = $state(false);

	// Available themes (Skeleton built-in)
	const themes = [
		{ id: 'cerberus', name: 'Cerberus' },
		{ id: 'catppuccin', name: 'Catppuccin' },
		{ id: 'pine', name: 'Pine' },
		{ id: 'rose', name: 'Rose' }
	];

	const navigation = [
		{ name: 'Home', href: '/' },
		{ name: 'Demos', href: '/demo' },
		{ name: 'GitHub', href: 'https://github.com/tinyland/pixelwise', external: true }
	];

	// Initialize from localStorage on mount (client-side only)
	onMount(() => {
		if (initialized) return;
		initialized = true;

		// Check for stored dark mode preference
		try {
			const stored = localStorage.getItem('dark-mode');
			if (stored !== null) {
				isDark = stored === 'true';
			} else {
				// Use system preference as default
				isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			}

			// Check for stored theme
			const storedTheme = localStorage.getItem('theme');
			if (storedTheme && themes.some((t) => t.id === storedTheme)) {
				currentTheme = storedTheme;
			}
		} catch {
			// localStorage may be unavailable (private browsing)
		}

		// Apply initial state to document
		applyDarkMode(isDark);
		applyTheme(currentTheme);

		// Check if onboarding should be shown
		showOnboarding = shouldShowOnboarding();
	});

	// Reactive effect: Apply dark mode to document.documentElement when isDark changes
	$effect(() => {
		if (browser && initialized) {
			applyDarkMode(isDark);
		}
	});

	// Reactive effect: Apply theme to document.documentElement when currentTheme changes
	$effect(() => {
		if (browser && initialized) {
			applyTheme(currentTheme);
		}
	});

	function applyDarkMode(dark: boolean) {
		if (!browser) return;

		const root = document.documentElement;
		if (dark) {
			root.classList.add('dark');
		} else {
			root.classList.remove('dark');
		}

		try {
			localStorage.setItem('dark-mode', String(dark));
		} catch {
			// localStorage may be unavailable
		}
	}

	function applyTheme(themeId: string) {
		if (!browser) return;

		const root = document.documentElement;
		root.setAttribute('data-theme', themeId);

		try {
			localStorage.setItem('theme', themeId);
		} catch {
			// localStorage may be unavailable
		}
	}

	function toggleDark() {
		isDark = !isDark;
	}
</script>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta
		name="description"
		content="Pixelwise: WebGPU + Futhark WASM multicore compositor for WCAG 2.1 AAA contrast adjustment"
	/>
</svelte:head>

<!-- Onboarding Modal -->
{#if showOnboarding}
	<OnboardingModal onClose={() => showOnboarding = false} />
{/if}

<!-- Main app container with theme -->
<div class="flex min-h-screen flex-col bg-surface-50-900" data-theme={currentTheme} class:dark={isDark}>
	<!-- Navigation Header -->
	<nav class="sticky top-0 z-50 border-b border-surface-200-700 bg-surface-50-900/95 backdrop-blur-sm">
		<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
			<div class="flex h-16 items-center justify-between">
				<!-- Logo/Brand -->
				<div class="flex items-center">
					<a
						href="/"
						class="bg-gradient-to-r from-primary-500 to-secondary-500 bg-clip-text text-xl font-bold text-transparent"
					>
						Pixelwise
					</a>
				</div>

				<!-- Desktop Navigation -->
				<div class="hidden items-center space-x-6 md:flex">
					{#each navigation as item}
						{@const isActive = !item.external && ($page.url.pathname === item.href || $page.url.pathname.startsWith(item.href + '/'))}
						<a
							href={item.href}
							class="text-surface-600-400 transition-colors hover:text-surface-900-100"
							class:text-primary-500={isActive}
							class:font-semibold={isActive}
							target={item.external ? '_blank' : undefined}
							rel={item.external ? 'noopener noreferrer' : undefined}
						>
							{item.name}
						</a>
					{/each}

					<!-- Theme Selector -->
					<select
						class="rounded-lg border border-surface-300-600 bg-surface-100-800 px-2 py-1 text-sm text-surface-900-100"
						bind:value={currentTheme}
					>
						{#each themes as theme}
							<option value={theme.id}>{theme.name}</option>
						{/each}
					</select>

					<!-- Dark Mode Toggle -->
					<button
						type="button"
						class="rounded-lg p-2 text-surface-600-400 transition-colors hover:bg-surface-100-800"
						onclick={toggleDark}
						aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
					>
						{#if isDark}
							<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
								/>
							</svg>
						{:else}
							<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
								/>
							</svg>
						{/if}
					</button>
				</div>

				<!-- Mobile menu button -->
				<div class="md:hidden">
					<button
						type="button"
						class="rounded-lg p-2 text-surface-600-400 hover:bg-surface-100-800"
						onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
						aria-label="Toggle menu"
						aria-expanded={mobileMenuOpen}
					>
						<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							{#if mobileMenuOpen}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							{:else}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 6h16M4 12h16M4 18h16"
								/>
							{/if}
						</svg>
					</button>
				</div>
			</div>

			<!-- Mobile Navigation Menu -->
			{#if mobileMenuOpen}
				<div class="border-t border-surface-200-700 py-4 md:hidden">
					<div class="flex flex-col space-y-3">
						{#each navigation as item}
							{@const isActive = !item.external && $page.url.pathname === item.href}
							<a
								href={item.href}
								class="px-2 py-1 text-surface-600-400 transition-colors hover:text-surface-900-100"
								class:text-primary-500={isActive}
								class:font-semibold={isActive}
								target={item.external ? '_blank' : undefined}
								rel={item.external ? 'noopener noreferrer' : undefined}
								onclick={() => (mobileMenuOpen = false)}
							>
								{item.name}
							</a>
						{/each}

						<!-- Mobile Theme Controls -->
						<div class="flex items-center gap-4 px-2 pt-4 border-t border-surface-200-700">
							<select
								class="flex-1 rounded-lg border border-surface-300-600 bg-surface-100-800 px-2 py-1 text-sm text-surface-900-100"
								bind:value={currentTheme}
							>
								{#each themes as theme}
									<option value={theme.id}>{theme.name}</option>
								{/each}
							</select>

							<button
								type="button"
								class="rounded-lg p-2 text-surface-600-400 hover:bg-surface-100-800"
								onclick={toggleDark}
								aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
							>
								{#if isDark}
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
										/>
									</svg>
								{:else}
									<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
										/>
									</svg>
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</nav>

	<!-- Main Content -->
	<main class="flex-1">
		{@render children()}
	</main>

	<!-- Footer -->
	<footer class="border-t border-surface-200-700 bg-surface-50-900 py-8">
		<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
			<div class="flex flex-col items-center justify-between gap-4 md:flex-row">
				<p class="text-sm text-surface-500-400">
					Pixelwise - WebGPU + Futhark WASM multicore compositor
				</p>
				<p class="text-sm text-surface-500-400">
					A research project exploring WebGPU and Futhark WASM for WCAG-compliant text rendering.
				</p>
			</div>
		</div>
	</footer>
</div>
