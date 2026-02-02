/**
 * ScreenCaptureSource Tests
 *
 * Tests for the Screen Capture API wrapper.
 *
 * Note: Many tests require mocking as the actual Screen Capture API
 * requires user interaction and browser permissions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the $app/environment module
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('ScreenCaptureSource', () => {
	// Store original global objects
	const originalNavigator = global.navigator;
	const originalDocument = global.document;
	const originalWindow = global.window;
	const originalHTMLVideoElement = global.HTMLVideoElement;

	beforeEach(() => {
		// Reset mocks before each test
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('isSupported', () => {
		it('should return true when getDisplayMedia is available', async () => {
			// Mock navigator.mediaDevices.getDisplayMedia
			Object.defineProperty(global, 'navigator', {
				value: {
					mediaDevices: {
						getDisplayMedia: vi.fn()
					}
				},
				writable: true
			});

			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			expect(ScreenCaptureSource.isSupported()).toBe(true);
		});

		it('should return false when getDisplayMedia is not available', async () => {
			Object.defineProperty(global, 'navigator', {
				value: {
					mediaDevices: {}
				},
				writable: true
			});

			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			expect(ScreenCaptureSource.isSupported()).toBe(false);
		});

		it('should return false when mediaDevices is not available', async () => {
			Object.defineProperty(global, 'navigator', {
				value: {},
				writable: true
			});

			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			expect(ScreenCaptureSource.isSupported()).toBe(false);
		});
	});

	describe('hasVideoFrameCallback', () => {
		it('should return true when requestVideoFrameCallback is available', async () => {
			Object.defineProperty(global, 'HTMLVideoElement', {
				value: {
					prototype: {
						requestVideoFrameCallback: vi.fn()
					}
				},
				writable: true
			});

			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			expect(ScreenCaptureSource.hasVideoFrameCallback()).toBe(true);
		});

		it('should return false when requestVideoFrameCallback is not available', async () => {
			Object.defineProperty(global, 'HTMLVideoElement', {
				value: {
					prototype: {}
				},
				writable: true
			});

			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			expect(ScreenCaptureSource.hasVideoFrameCallback()).toBe(false);
		});
	});

	describe('constructor', () => {
		it('should create instance with default config', async () => {
			const { ScreenCaptureSource, DEFAULT_CAPTURE_CONFIG } = await import(
				'$lib/capture/ScreenCaptureSource'
			);

			const source = new ScreenCaptureSource();

			expect(source.state).toBe('idle');
			expect(source.isActive).toBe(false);
			expect(source.width).toBe(0);
			expect(source.height).toBe(0);
		});

		it('should create instance with custom config', async () => {
			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');

			const customConfig = {
				cursor: 'never' as const,
				displaySurface: 'window' as const,
				frameRate: 30
			};

			const source = new ScreenCaptureSource(customConfig);

			expect(source.state).toBe('idle');
		});
	});

	describe('state management', () => {
		it('should start in idle state', async () => {
			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			const source = new ScreenCaptureSource();

			expect(source.state).toBe('idle');
			expect(source.isActive).toBe(false);
		});

		it('should transition to stopped state on stop()', async () => {
			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			const source = new ScreenCaptureSource();

			source.stop();

			expect(source.state).toBe('stopped');
		});
	});

	describe('frame callback', () => {
		it('should register frame callback', async () => {
			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			const source = new ScreenCaptureSource();

			const callback = vi.fn();
			source.onFrame(callback);

			// Callback should be stored but not called yet (no active capture)
			expect(callback).not.toHaveBeenCalled();
		});

		it('should remove frame callback on offFrame()', async () => {
			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
			const source = new ScreenCaptureSource();

			const callback = vi.fn();
			source.onFrame(callback);
			source.offFrame();

			// No error should occur
			expect(source.state).toBe('idle');
		});
	});
});

describe('DEFAULT_CAPTURE_CONFIG', () => {
	it('should have sensible defaults', async () => {
		const { DEFAULT_CAPTURE_CONFIG } = await import('$lib/capture/ScreenCaptureSource');

		expect(DEFAULT_CAPTURE_CONFIG.cursor).toBe('always');
		expect(DEFAULT_CAPTURE_CONFIG.displaySurface).toBe('monitor');
		expect(DEFAULT_CAPTURE_CONFIG.selfBrowserSurface).toBe('exclude');
		expect(DEFAULT_CAPTURE_CONFIG.systemAudio).toBe('exclude');
		expect(DEFAULT_CAPTURE_CONFIG.preferCurrentTab).toBe(false);
		expect(DEFAULT_CAPTURE_CONFIG.frameRate).toBe(60);
	});
});

describe('createScreenCaptureSource', () => {
	it('should create ScreenCaptureSource instance', async () => {
		const { createScreenCaptureSource, ScreenCaptureSource } = await import(
			'$lib/capture/ScreenCaptureSource'
		);

		const source = createScreenCaptureSource();

		expect(source).toBeInstanceOf(ScreenCaptureSource);
		expect(source.state).toBe('idle');
	});

	it('should accept custom config', async () => {
		const { createScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');

		const source = createScreenCaptureSource({
			cursor: 'motion',
			frameRate: 24
		});

		expect(source.state).toBe('idle');
	});
});
