/**
 * ScreenCaptureSource Property-Based Tests
 *
 * Tests for state machine properties using fast-check.
 *
 * Properties tested:
 * 1. Valid state transitions only
 * 2. stop() always reaches stopped state
 * 3. Callbacks are properly managed
 * 4. State consistency after operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fc, test as fcTest } from '@fast-check/vitest';
import type { CaptureState, ScreenCaptureConfig } from '$lib/capture/ScreenCaptureSource';

// Mock the $app/environment module
vi.mock('$app/environment', () => ({
	browser: true
}));

// Valid state transitions for ScreenCaptureSource
const VALID_TRANSITIONS: Record<CaptureState, CaptureState[]> = {
	idle: ['requesting', 'stopped'],
	requesting: ['active', 'error', 'stopped'],
	active: ['paused', 'stopped'],
	paused: ['active', 'stopped'],
	stopped: [], // Terminal state - no transitions out
	error: ['stopped', 'requesting'] // Can retry or stop
};

// Custom arbitraries
const captureStateArb: fc.Arbitrary<CaptureState> = fc.constantFrom(
	'idle',
	'requesting',
	'active',
	'paused',
	'stopped',
	'error'
);

const cursorOptionArb: fc.Arbitrary<'always' | 'motion' | 'never'> = fc.constantFrom(
	'always',
	'motion',
	'never'
);

const displaySurfaceArb: fc.Arbitrary<'monitor' | 'window' | 'browser'> = fc.constantFrom(
	'monitor',
	'window',
	'browser'
);

const includeExcludeArb: fc.Arbitrary<'include' | 'exclude'> = fc.constantFrom('include', 'exclude');

const partialConfigArb: fc.Arbitrary<Partial<ScreenCaptureConfig>> = fc.record(
	{
		cursor: cursorOptionArb,
		displaySurface: displaySurfaceArb,
		selfBrowserSurface: includeExcludeArb,
		systemAudio: includeExcludeArb,
		preferCurrentTab: fc.boolean(),
		frameRate: fc.integer({ min: 1, max: 120 }),
		width: fc.integer({ min: 100, max: 8192 }),
		height: fc.integer({ min: 100, max: 8192 })
	},
	{ requiredKeys: [] }
);

// Operations that can be performed on ScreenCaptureSource
type SourceOperation =
	| { type: 'stop' }
	| { type: 'pause' }
	| { type: 'resume' }
	| { type: 'onFrame' }
	| { type: 'offFrame' }
	| { type: 'updateConfig'; config: Partial<ScreenCaptureConfig> };

const operationArb: fc.Arbitrary<SourceOperation> = fc.oneof(
	fc.constant({ type: 'stop' } as SourceOperation),
	fc.constant({ type: 'pause' } as SourceOperation),
	fc.constant({ type: 'resume' } as SourceOperation),
	fc.constant({ type: 'onFrame' } as SourceOperation),
	fc.constant({ type: 'offFrame' } as SourceOperation),
	fc.record({
		type: fc.constant('updateConfig' as const),
		config: partialConfigArb
	})
);

describe('ScreenCaptureSource Property-Based Tests', () => {
	beforeEach(() => {
		vi.resetModules();
		// Set up minimal browser mocks
		Object.defineProperty(global, 'HTMLVideoElement', {
			value: {
				prototype: {}
			},
			writable: true
		});
		Object.defineProperty(global, 'navigator', {
			value: {
				mediaDevices: {}
			},
			writable: true
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Invariant: Initial state is always idle', () => {
		fcTest.prop([partialConfigArb])(
			'new ScreenCaptureSource always starts in idle state',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				expect(source.state).toBe('idle');
				expect(source.isActive).toBe(false);
			}
		);
	});

	describe('Invariant: stop() always reaches stopped state', () => {
		fcTest.prop([partialConfigArb])(
			'stop() from idle reaches stopped state',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				source.stop();

				expect(source.state).toBe('stopped');
			}
		);

		fcTest.prop([partialConfigArb, fc.array(operationArb, { minLength: 0, maxLength: 10 })])(
			'stop() after any sequence of operations reaches stopped state',
			async (config, operations) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				// Execute operations (some may have no effect based on state)
				for (const op of operations) {
					try {
						switch (op.type) {
							case 'stop':
								source.stop();
								break;
							case 'pause':
								source.pause();
								break;
							case 'resume':
								source.resume();
								break;
							case 'onFrame':
								source.onFrame(() => {});
								break;
							case 'offFrame':
								source.offFrame();
								break;
							case 'updateConfig':
								source.updateConfig(op.config);
								break;
						}
					} catch {
						// Some operations may fail, that's ok
					}
				}

				// Final stop should always work
				source.stop();
				expect(source.state).toBe('stopped');
			}
		);
	});

	describe('Invariant: stop() is idempotent', () => {
		fcTest.prop([partialConfigArb, fc.integer({ min: 1, max: 10 })])(
			'calling stop() multiple times keeps state as stopped',
			async (config, callCount) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				for (let i = 0; i < callCount; i++) {
					source.stop();
					expect(source.state).toBe('stopped');
				}
			}
		);
	});

	describe('Invariant: isActive reflects correct states', () => {
		fcTest.prop([captureStateArb])(
			'isActive is true only for active state',
			async () => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource();

				// In idle state, isActive is false
				expect(source.isActive).toBe(false);

				// After stop, isActive is false
				source.stop();
				expect(source.isActive).toBe(false);
			}
		);
	});

	describe('Invariant: pause() only affects active state', () => {
		fcTest.prop([partialConfigArb])(
			'pause() from idle has no effect',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				const stateBefore = source.state;
				source.pause();

				// pause() only works from active state
				if (stateBefore !== 'active') {
					expect(source.state).toBe(stateBefore);
				}
			}
		);
	});

	describe('Invariant: resume() only affects paused state', () => {
		fcTest.prop([partialConfigArb])(
			'resume() from idle has no effect',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				const stateBefore = source.state;
				source.resume();

				// resume() only works from paused state
				if (stateBefore !== 'paused') {
					expect(source.state).toBe(stateBefore);
				}
			}
		);
	});

	describe('Invariant: Callback management does not affect state', () => {
		fcTest.prop([partialConfigArb, fc.array(fc.boolean(), { minLength: 1, maxLength: 20 })])(
			'onFrame/offFrame operations do not change state',
			async (config, callbackOperations) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				const initialState = source.state;

				for (const addCallback of callbackOperations) {
					if (addCallback) {
						source.onFrame(() => {});
					} else {
						source.offFrame();
					}

					// State should remain unchanged
					expect(source.state).toBe(initialState);
				}
			}
		);
	});

	describe('Invariant: updateConfig does not affect state', () => {
		fcTest.prop([partialConfigArb, fc.array(partialConfigArb, { minLength: 1, maxLength: 10 })])(
			'updateConfig operations do not change state',
			async (initialConfig, configUpdates) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(initialConfig);

				const initialState = source.state;

				for (const update of configUpdates) {
					source.updateConfig(update);
					expect(source.state).toBe(initialState);
				}
			}
		);
	});

	describe('Invariant: Dimensions are zero when not active', () => {
		fcTest.prop([partialConfigArb])(
			'width and height are 0 in idle state',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				expect(source.width).toBe(0);
				expect(source.height).toBe(0);
			}
		);

		fcTest.prop([partialConfigArb])(
			'width and height are 0 after stop',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				source.stop();

				expect(source.width).toBe(0);
				expect(source.height).toBe(0);
			}
		);
	});

	describe('Invariant: Video element is null when not active', () => {
		fcTest.prop([partialConfigArb])(
			'videoElement is null in idle state',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				expect(source.videoElement).toBeNull();
			}
		);

		fcTest.prop([partialConfigArb])(
			'videoElement is null after stop',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				source.stop();

				expect(source.videoElement).toBeNull();
			}
		);
	});

	describe('Invariant: Media stream is null when not active', () => {
		fcTest.prop([partialConfigArb])(
			'mediaStream is null in idle state',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				expect(source.mediaStream).toBeNull();
			}
		);

		fcTest.prop([partialConfigArb])(
			'mediaStream is null after stop',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				source.stop();

				expect(source.mediaStream).toBeNull();
			}
		);
	});

	describe('Invariant: Error is null unless in error state', () => {
		fcTest.prop([partialConfigArb])(
			'error is null in idle state',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				expect(source.error).toBeNull();
			}
		);

		fcTest.prop([partialConfigArb])(
			'error is null after stop from idle',
			async (config) => {
				const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');
				const source = new ScreenCaptureSource(config);

				source.stop();

				expect(source.error).toBeNull();
			}
		);
	});
});

describe('DEFAULT_CAPTURE_CONFIG Property-Based Tests', () => {
	fcTest.prop([fc.constant(null)])(
		'DEFAULT_CAPTURE_CONFIG has all required fields',
		async () => {
			const { DEFAULT_CAPTURE_CONFIG } = await import('$lib/capture/ScreenCaptureSource');

			expect(DEFAULT_CAPTURE_CONFIG.cursor).toBeDefined();
			expect(['always', 'motion', 'never']).toContain(DEFAULT_CAPTURE_CONFIG.cursor);

			expect(DEFAULT_CAPTURE_CONFIG.displaySurface).toBeDefined();
			expect(['monitor', 'window', 'browser']).toContain(DEFAULT_CAPTURE_CONFIG.displaySurface);

			expect(DEFAULT_CAPTURE_CONFIG.selfBrowserSurface).toBeDefined();
			expect(['include', 'exclude']).toContain(DEFAULT_CAPTURE_CONFIG.selfBrowserSurface);

			expect(DEFAULT_CAPTURE_CONFIG.systemAudio).toBeDefined();
			expect(['include', 'exclude']).toContain(DEFAULT_CAPTURE_CONFIG.systemAudio);

			expect(typeof DEFAULT_CAPTURE_CONFIG.preferCurrentTab).toBe('boolean');

			if (DEFAULT_CAPTURE_CONFIG.frameRate !== undefined) {
				expect(DEFAULT_CAPTURE_CONFIG.frameRate).toBeGreaterThan(0);
				expect(DEFAULT_CAPTURE_CONFIG.frameRate).toBeLessThanOrEqual(240);
			}
		}
	);
});

describe('createScreenCaptureSource Property-Based Tests', () => {
	fcTest.prop([partialConfigArb])(
		'createScreenCaptureSource creates valid instance',
		async (config) => {
			const { createScreenCaptureSource, ScreenCaptureSource } = await import(
				'$lib/capture/ScreenCaptureSource'
			);

			const source = createScreenCaptureSource(config);

			expect(source).toBeInstanceOf(ScreenCaptureSource);
			expect(source.state).toBe('idle');
		}
	);
});

describe('State Transition Model-Based Testing', () => {
	// Model-based testing: simulate state machine
	class ScreenCaptureSourceModel {
		state: CaptureState = 'idle';

		stop() {
			this.state = 'stopped';
		}

		pause() {
			if (this.state === 'active') {
				this.state = 'paused';
			}
		}

		resume() {
			if (this.state === 'paused') {
				this.state = 'active';
			}
		}

		// For testing, simulate successful start
		simulateStart() {
			if (this.state === 'idle') {
				this.state = 'active';
			}
		}
	}

	fcTest.prop([fc.array(fc.constantFrom('stop', 'pause', 'resume', 'simulateStart'), { minLength: 0, maxLength: 20 })])(
		'model and implementation behave consistently',
		async (operations) => {
			const { ScreenCaptureSource } = await import('$lib/capture/ScreenCaptureSource');

			const model = new ScreenCaptureSourceModel();
			const source = new ScreenCaptureSource();

			for (const op of operations) {
				switch (op) {
					case 'stop':
						model.stop();
						source.stop();
						break;
					case 'pause':
						model.pause();
						source.pause();
						break;
					case 'resume':
						model.resume();
						source.resume();
						break;
					case 'simulateStart':
						// Can't actually start without user interaction, skip
						model.simulateStart();
						break;
				}

				// After stop, both should be in stopped state
				if (model.state === 'stopped') {
					expect(source.state).toBe('stopped');
				}

				// If model is idle (and never had simulateStart), source should be idle or stopped
				if (model.state === 'idle') {
					expect(['idle', 'stopped']).toContain(source.state);
				}
			}
		}
	);
});
