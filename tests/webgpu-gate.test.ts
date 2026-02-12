/**
 * WebGPU Gate Enforcement Tests
 *
 * Tests for the WebGPU availability gate:
 *   - shouldBlockDemos() returns correct state based on webgpuAvailable
 *   - updateWebGPUAvailability() persists to localStorage
 *   - Gate remains active even after completing onboarding
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true
}));

const mockStorage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (key: string) => mockStorage.get(key) ?? null,
		setItem: (key: string, value: string) => mockStorage.set(key, value),
		removeItem: (key: string) => mockStorage.delete(key),
		clear: () => mockStorage.clear()
	},
	writable: true
});

describe('WebGPU Gate', () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	describe('shouldBlockDemos', () => {
		it('should return false when no consent data exists', async () => {
			const { shouldBlockDemos } = await import('$lib/utils/consentStorage');
			// No consent stored = no webgpuAvailable info yet
			expect(shouldBlockDemos()).toBe(false);
		});

		it('should return true when webgpuAvailable is false', async () => {
			const { shouldBlockDemos, setConsent } = await import('$lib/utils/consentStorage');

			setConsent({ acknowledged: true, webgpuAvailable: false });
			expect(shouldBlockDemos()).toBe(true);
		});

		it('should return false when webgpuAvailable is true', async () => {
			const { shouldBlockDemos, setConsent } = await import('$lib/utils/consentStorage');

			setConsent({ acknowledged: true, webgpuAvailable: true });
			expect(shouldBlockDemos()).toBe(false);
		});

		it('should still block after completing onboarding without WebGPU', async () => {
			const { shouldBlockDemos, completeOnboarding, updateWebGPUAvailability } = await import('$lib/utils/consentStorage');

			completeOnboarding();
			updateWebGPUAvailability(false);

			expect(shouldBlockDemos()).toBe(true);
		});

		it('should not block after completing onboarding with WebGPU', async () => {
			const { shouldBlockDemos, completeOnboarding, updateWebGPUAvailability } = await import('$lib/utils/consentStorage');

			completeOnboarding();
			updateWebGPUAvailability(true);

			expect(shouldBlockDemos()).toBe(false);
		});
	});

	describe('updateWebGPUAvailability', () => {
		it('should persist webgpuAvailable to localStorage', async () => {
			const { updateWebGPUAvailability, getConsent } = await import('$lib/utils/consentStorage');

			updateWebGPUAvailability(true);
			const consent = getConsent();

			expect(consent).not.toBeNull();
			expect(consent!.webgpuAvailable).toBe(true);
		});

		it('should update existing consent data', async () => {
			const { updateWebGPUAvailability, setConsent, getConsent } = await import('$lib/utils/consentStorage');

			setConsent({ acknowledged: true, detectedBackend: 'webgpu' });
			updateWebGPUAvailability(true);

			const consent = getConsent();
			expect(consent!.acknowledged).toBe(true);
			expect(consent!.detectedBackend).toBe('webgpu');
			expect(consent!.webgpuAvailable).toBe(true);
		});

		it('should toggle from true to false', async () => {
			const { updateWebGPUAvailability, getConsent } = await import('$lib/utils/consentStorage');

			updateWebGPUAvailability(true);
			expect(getConsent()!.webgpuAvailable).toBe(true);

			updateWebGPUAvailability(false);
			expect(getConsent()!.webgpuAvailable).toBe(false);
		});
	});
});
