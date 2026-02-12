import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import mdsvexConfig from './mdsvex.config.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// MDsveX must be BEFORE vitePreprocess to handle .md/.mdx files first
	preprocess: [
		mdsvex(mdsvexConfig),
		vitePreprocess()
	],

	// Include all markdown extensions that mdsvex processes
	extensions: ['.svelte', '.svelte.md', '.md', '.svx', '.mdx'],

	kit: {
		adapter: adapter({ out: 'dist' })
	},

	// Svelte 5 runes configuration
	// MDsveX files need runes: undefined (let MDsveX handle compilation)
	// Regular .svelte files use runes: true for Skeleton v5 components
	vitePlugin: {
		dynamicCompileOptions({ filename }) {
			if (filename.endsWith('.md') || filename.endsWith('.mdx') || filename.endsWith('.svx')) {
				return { runes: undefined };
			}
			return { runes: true };
		}
	}
};

export default config;
