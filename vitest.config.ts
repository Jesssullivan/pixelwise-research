import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [
		svelte({
			// Svelte 5 runes support for .svelte.ts files
			compilerOptions: {
				runes: true
			}
		})
	],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/setup.ts'],
		include: ['tests/**/*.test.ts'],
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/.svelte-kit/**',
			'tests/e2e/**', // E2E tests use Playwright, not Vitest
			'tests/a11ywag/**', // Pixel contrast tests use separate config
			'tests/_archived/**' // Archived tests for removed modules
		],
		// Extended timeouts for a11y and visual tests
		testTimeout: 60000,
		hookTimeout: 30000,
		// Reporters for CI/local dev (v4: 'verbose' now flat; use 'default' for tree view)
		reporters: process.env.CI ? ['dot', 'json'] : ['default'],
		// Output for CI
		outputFile: process.env.CI ? './test-results/vitest.json' : undefined,
		// Coverage configuration (v4: explicit include patterns required for best practice)
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			reportsDirectory: './coverage',
			// v4: Define explicit include patterns for coverage
			include: [
				'src/**/*.{js,ts,svelte}',
				'!src/**/*.d.ts',
				'!src/**/*.config.*'
			],
			exclude: [
				'node_modules',
				'tests',
				'**/*.d.ts',
				'**/*.config.*',
				'.svelte-kit'
			]
		}
	},
	resolve: {
		alias: {
			$lib: resolve('./src/lib'),
			$app: resolve('./node_modules/@sveltejs/kit/src/runtime/app'),
			// Additional aliases for test compatibility
			'$lib/server': resolve('./src/lib/server'),
			'$lib/client': resolve('./src/lib/client'),
			'$lib/components': resolve('./src/lib/components'),
			'$lib/stores': resolve('./src/lib/stores'),
			'$lib/types': resolve('./src/lib/types'),
			'$lib/utils': resolve('./src/lib/utils'),
			// Pixelwise virtual module alias
			'virtual:pixelwise-pulsing': resolve('./src/vite-plugin-types/pixelwise-pulsing.js'),
			// Mock $env modules for tests
			'$env/dynamic/private': resolve('./tests/mocks/env-dynamic-private.ts'),
			'$env/static/private': resolve('./tests/mocks/env-static-private.ts'),
			'$env/dynamic/public': resolve('./tests/mocks/env-dynamic-public.ts'),
			'$env/static/public': resolve('./tests/mocks/env-static-public.ts')
		}
	}
});
