/**
 * Onboarding Wizard Tests
 *
 * Tests for the 5-step onboarding wizard:
 *   - Consent storage v1 → v2 migration
 *   - Step progression logic
 *   - Consent data management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock $app/environment for consentStorage
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock localStorage
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

describe('Onboarding Wizard', () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	describe('Consent Storage v2', () => {
		it('should return null when no consent exists', async () => {
			const { getConsent } = await import('$lib/utils/consentStorage');
			expect(getConsent()).toBeNull();
		});

		it('should save and retrieve v2 consent data', async () => {
			const { setConsent, getConsent } = await import('$lib/utils/consentStorage');

			setConsent({
				acknowledged: true,
				screenCaptureGranted: true,
				paperViewed: false,
				completedSteps: [1, 2, 3],
				detectedBackend: 'webgpu'
			});

			const consent = getConsent();
			expect(consent).not.toBeNull();
			expect(consent!.acknowledged).toBe(true);
			expect(consent!.screenCaptureGranted).toBe(true);
			expect(consent!.paperViewed).toBe(false);
			expect(consent!.completedSteps).toEqual([1, 2, 3]);
			expect(consent!.detectedBackend).toBe('webgpu');
			expect(consent!.version).toBe(2);
		});

		it('should migrate v1 consent to v2', async () => {
			// Write v1 consent directly
			mockStorage.set('pixelwise-onboarding-consent', JSON.stringify({
				acknowledged: true,
				timestamp: 1700000000000,
				webgpuInstructionsSeen: true,
				screenCaptureExplained: true,
				version: 1
			}));

			const { getConsent } = await import('$lib/utils/consentStorage');
			const consent = getConsent();

			expect(consent).not.toBeNull();
			expect(consent!.version).toBe(2);
			expect(consent!.acknowledged).toBe(true);
			expect(consent!.webgpuInstructionsSeen).toBe(true);
			expect(consent!.screenCaptureExplained).toBe(true);
			// Migrated fields should have defaults
			expect(consent!.screenCaptureGranted).toBe(false);
			expect(consent!.paperViewed).toBe(false);
			expect(consent!.detectedBackend).toBe('');
			// Acknowledged v1 → all steps completed
			expect(consent!.completedSteps).toEqual([1, 2, 3, 4, 5]);
		});

		it('should migrate v1 non-acknowledged consent correctly', async () => {
			mockStorage.set('pixelwise-onboarding-consent', JSON.stringify({
				acknowledged: false,
				timestamp: 1700000000000,
				webgpuInstructionsSeen: false,
				screenCaptureExplained: false,
				version: 1
			}));

			const { getConsent } = await import('$lib/utils/consentStorage');
			const consent = getConsent();

			expect(consent).not.toBeNull();
			expect(consent!.version).toBe(2);
			expect(consent!.acknowledged).toBe(false);
			expect(consent!.completedSteps).toEqual([]); // Not acknowledged → no steps
		});

		it('should persist migrated data to localStorage', async () => {
			mockStorage.set('pixelwise-onboarding-consent', JSON.stringify({
				acknowledged: true,
				timestamp: 1700000000000,
				webgpuInstructionsSeen: true,
				screenCaptureExplained: true,
				version: 1
			}));

			const { getConsent } = await import('$lib/utils/consentStorage');
			getConsent(); // Triggers migration

			// Re-read from storage should now be v2
			const raw = JSON.parse(mockStorage.get('pixelwise-onboarding-consent')!);
			expect(raw.version).toBe(2);
			expect(raw.screenCaptureGranted).toBe(false);
		});

		it('should handle invalid JSON gracefully', async () => {
			mockStorage.set('pixelwise-onboarding-consent', 'not-json');

			const { getConsent } = await import('$lib/utils/consentStorage');
			expect(getConsent()).toBeNull();
		});

		it('should handle missing acknowledged field', async () => {
			mockStorage.set('pixelwise-onboarding-consent', JSON.stringify({ version: 2 }));

			const { getConsent } = await import('$lib/utils/consentStorage');
			expect(getConsent()).toBeNull();
		});
	});

	describe('completeOnboarding', () => {
		it('should mark all fields as complete', async () => {
			const { completeOnboarding, getConsent } = await import('$lib/utils/consentStorage');

			completeOnboarding();

			const consent = getConsent();
			expect(consent).not.toBeNull();
			expect(consent!.acknowledged).toBe(true);
			expect(consent!.webgpuInstructionsSeen).toBe(true);
			expect(consent!.screenCaptureExplained).toBe(true);
		});
	});

	describe('shouldShowOnboarding', () => {
		it('should return true when no consent exists', async () => {
			const { shouldShowOnboarding } = await import('$lib/utils/consentStorage');
			expect(shouldShowOnboarding()).toBe(true);
		});

		it('should return false after completing onboarding', async () => {
			const { completeOnboarding, shouldShowOnboarding } = await import('$lib/utils/consentStorage');

			completeOnboarding();
			expect(shouldShowOnboarding()).toBe(false);
		});
	});

	describe('resetConsent', () => {
		it('should clear stored consent', async () => {
			const { completeOnboarding, resetConsent, shouldShowOnboarding } = await import('$lib/utils/consentStorage');

			completeOnboarding();
			expect(shouldShowOnboarding()).toBe(false);

			resetConsent();
			expect(shouldShowOnboarding()).toBe(true);
		});
	});

	describe('webgpuAvailable field', () => {
		it('should default to false in new consent', async () => {
			const { setConsent, getConsent } = await import('$lib/utils/consentStorage');

			setConsent({ acknowledged: false });
			const consent = getConsent();
			expect(consent!.webgpuAvailable).toBe(false);
		});

		it('should be settable via updateWebGPUAvailability', async () => {
			const { updateWebGPUAvailability, getConsent } = await import('$lib/utils/consentStorage');

			updateWebGPUAvailability(true);
			expect(getConsent()!.webgpuAvailable).toBe(true);
		});

		it('should be preserved across setConsent calls', async () => {
			const { setConsent, updateWebGPUAvailability, getConsent } = await import('$lib/utils/consentStorage');

			updateWebGPUAvailability(true);
			setConsent({ acknowledged: true });

			expect(getConsent()!.webgpuAvailable).toBe(true);
		});
	});

	describe('getConsentAge', () => {
		it('should return null when no consent', async () => {
			const { getConsentAge } = await import('$lib/utils/consentStorage');
			expect(getConsentAge()).toBeNull();
		});

		it('should return 0 for fresh consent', async () => {
			const { completeOnboarding, getConsentAge } = await import('$lib/utils/consentStorage');

			completeOnboarding();
			const age = getConsentAge();
			expect(age).toBe(0);
		});
	});
});
