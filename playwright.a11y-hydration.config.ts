/**
 * Playwright configuration for A11y Store Hydration Tests
 *
 * Focused on testing:
 * - SSR safety (no intervals during server rendering)
 * - Memory leak detection
 * - Interval cleanup verification
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: '**/a11y-*.spec.ts',

	// Timeout for each test
	timeout: 60_000, // 60 seconds (some tests wait for intervals)

	// Expect timeout for assertions
	expect: {
		timeout: 10_000
	},

	// Run tests in parallel
	fullyParallel: true,

	// Fail the build on CI if you accidentally left test.only
	forbidOnly: !!process.env.CI,

	// Retry on CI only
	retries: process.env.CI ? 2 : 0,

	// Workers
	workers: process.env.CI ? 1 : undefined,

	// Reporter
	reporter: [
		['html', { outputFolder: 'playwright-report-a11y' }],
		['json', { outputFile: 'test-results-a11y.json' }],
		['list']
	],

	// Shared settings for all projects
	use: {
		// Base URL
		baseURL: process.env.PUBLIC_BASE_URL || 'http://localhost:5174',

		// Collect trace on failure
		trace: 'on-first-retry',

		// Screenshot on failure
		screenshot: 'only-on-failure',

		// Video on failure
		video: 'retain-on-failure',

		// Enable console logging
		launchOptions: {
			args: [
				'--enable-precise-memory-info', // Enable performance.memory API
				'--expose-gc' // Allow manual GC triggering
			]
		}
	},

	// Global setup for interval tracking
	globalSetup: require.resolve('./tests/a11y-interval-tracking.setup.ts'),

	// Test projects
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Enable memory profiling
				contextOptions: {
					deviceScaleFactor: 1
				}
			}
		},

		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] }
		},

		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] }
		},

		// Mobile tests (important for memory constraints)
		{
			name: 'Mobile Chrome',
			use: { ...devices['Pixel 5'] }
		},

		{
			name: 'Mobile Safari',
			use: { ...devices['iPhone 12'] }
		}
	],

	// Dev server
	webServer: {
		command: 'pnpm run dev:container',
		url: 'http://localhost:5174',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
