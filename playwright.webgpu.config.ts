import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: '**/webgpu-canary.spec.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 120_000,
	expect: {
		timeout: 60_000
	},
	reporter: [
		['html', { outputFolder: 'playwright-report-webgpu' }],
		['json', { outputFile: 'test-results/webgpu-results.json' }],
		['list']
	],
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'off'
	},
	projects: [
		{
			name: 'chromium-webgpu',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1440, height: 960 },
				launchOptions: {
					executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
					args: [
						'--enable-unsafe-webgpu',
						'--enable-features=Vulkan',
						'--ignore-gpu-blocklist',
						'--use-angle=vulkan'
					]
				}
			}
		}
	],
	webServer: process.env.CI
		? {
				command: 'PORT=5173 pnpm run dev',
				port: 5173,
				reuseExistingServer: false,
				timeout: 120_000
			}
		: undefined
});
