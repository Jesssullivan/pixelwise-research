import { defineConfig, devices } from '@playwright/test';

/**
 * Multi-browser E2E test configuration for accessibility testing
 * Tests contrast ratios across all major browsers and devices
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // Disable full parallelism locally to prevent resource exhaustion
  fullyParallel: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Limit workers to prevent overwhelming the machine
  // CI: 2 workers, Local: 2 workers (was unlimited!)
  workers: process.env.CI ? 2 : 2,
  reporter: [
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
    ['./tests/accessibility/loki-reporter.ts']
  ],
  
  use: {
    // Use Caddy proxy port for containerized dev environment
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Accessibility testing specific settings
    contextOptions: {
      // Enable accessibility testing features
      reducedMotion: 'reduce',
      forcedColors: 'none',
    }
  },

  projects: [
    // Desktop browsers
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 }
      },
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      },
    },
    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 }
      },
    },
    {
      name: 'edge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        viewport: { width: 1280, height: 720 }
      },
    },

    // Mobile browsers
    {
      name: 'mobile-chrome',
      use: { 
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 851 }
      },
    },
    {
      name: 'mobile-safari',
      use: { 
        ...devices['iPhone 12'],
        viewport: { width: 390, height: 844 }
      },
    },
    {
      name: 'tablet-safari',
      use: { 
        ...devices['iPad (gen 7)'],
        viewport: { width: 810, height: 1080 }
      },
    },

    // High contrast mode testing
    {
      name: 'chromium-high-contrast',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        contextOptions: {
          forcedColors: 'active',
        }
      },
    },

    // Dark mode preference testing
    {
      name: 'chromium-dark-mode',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        colorScheme: 'dark',
      },
    },
  ],

  // Web server configuration - use existing containerized dev environment
  // Run `pnpm run dev:full:noauth` before running tests
  webServer: process.env.CI ? {
    command: 'pnpm run dev',
    port: 5173,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  } : undefined,

  // Timeout configurations
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
});