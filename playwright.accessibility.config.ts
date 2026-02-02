import { defineConfig, devices } from '@playwright/test';

/**
 * Optimized Playwright configuration for accessibility tests
 * Target: Run full accessibility audit across all permutations in under 10 minutes
 */
export default defineConfig({
  testDir: './tests/accessibility',
  
  // Maximum parallel execution
  fullyParallel: true,
  
  // Increase workers for accessibility tests (use all available CPUs)
  workers: process.env.CI ? 4 : '100%',
  
  // Disable retries for faster execution
  retries: 0,
  
  // Set timeout for accessibility tests
  timeout: 30 * 1000, // 30 seconds per test
  
  // Global timeout for the entire test run
  globalTimeout: 10 * 60 * 1000, // 10 minutes total
  
  // Reporter configuration
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/accessibility-report.json' }],
    ['junit', { outputFile: 'test-results/accessibility-junit.xml' }],
    ['list']
  ],
  
  // Shared settings optimized for performance
  use: {
    baseURL: 'http://localhost:5174',
    
    // Disable animations for faster execution
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--force-color-profile=srgb'
      ]
    },
    
    // Reduce screenshot size for performance
    screenshot: {
      mode: 'only-on-failure',
      fullPage: false
    },
    
    // Disable video recording
    video: 'off',
    
    // Disable tracing for performance
    trace: 'off',
    
    // Set viewport for consistency
    viewport: { width: 1280, height: 720 },
    
    // Reduce navigation timeout
    navigationTimeout: 15000,
    
    // Action timeout
    actionTimeout: 10000,
    
    // Disable service workers for consistency
    serviceWorkers: 'block',
    
    // Ignore HTTPS errors
    ignoreHTTPSErrors: true,
    
    // Reduce wait times
    hasTouch: false,
    isMobile: false,
    
    // Browser context options for performance
    contextOptions: {
      reducedMotion: 'reduce',
      forcedColors: 'none'
    }
  },

  // Test sharding configuration
  ...(process.env.SHARD ? {
    shard: {
      total: parseInt(process.env.TOTAL_SHARDS || '4'),
      current: parseInt(process.env.SHARD || '1')
    }
  } : {}),

  // Projects optimized for accessibility testing
  projects: [
    {
      name: 'chromium-accessibility',
      use: { 
        ...devices['Desktop Chrome'],
        // Use persistent context for browser reuse
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled']
        }
      },
    },
    // Only test on one browser for accessibility
    // Other browsers can be added if needed
  ],

  // Pre-run setup
  // globalSetup: './tests/accessibility/global-setup.ts',
  
  // Post-run teardown
  // globalTeardown: './tests/accessibility/global-teardown.ts',
});