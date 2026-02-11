/**
 * Consent Storage Utility for Pixelwise Onboarding
 *
 * Manages localStorage-based consent state for the onboarding modal.
 * Tracks whether users have acknowledged the onboarding information
 * including WebGPU instructions, screen capture explanation, etc.
 */

import { browser } from '$app/environment';

const CONSENT_KEY = 'pixelwise-onboarding-consent';

export interface ConsentDataV1 {
	acknowledged: boolean;
	timestamp: number;
	webgpuInstructionsSeen: boolean;
	screenCaptureExplained: boolean;
	version: 1;
}

export interface ConsentData {
	/** User has completed onboarding */
	acknowledged: boolean;
	/** Timestamp when consent was given */
	timestamp: number;
	/** User has seen WebGPU instructions (if applicable) */
	webgpuInstructionsSeen: boolean;
	/** User has read screen capture explanation */
	screenCaptureExplained: boolean;
	/** Screen capture permission has been granted */
	screenCaptureGranted: boolean;
	/** User has viewed the research paper */
	paperViewed: boolean;
	/** Wizard steps the user has completed (1-indexed) */
	completedSteps: number[];
	/** Detected compute backend at onboarding time */
	detectedBackend: string;
	/** Version of onboarding shown (for future migrations) */
	version: number;
}

const DEFAULT_CONSENT: ConsentData = {
	acknowledged: false,
	timestamp: 0,
	webgpuInstructionsSeen: false,
	screenCaptureExplained: false,
	screenCaptureGranted: false,
	paperViewed: false,
	completedSteps: [],
	detectedBackend: '',
	version: 2
};

/**
 * Migrate v1 consent data to v2
 */
function migrateV1toV2(v1: ConsentDataV1): ConsentData {
	return {
		...DEFAULT_CONSENT,
		acknowledged: v1.acknowledged,
		timestamp: v1.timestamp,
		webgpuInstructionsSeen: v1.webgpuInstructionsSeen,
		screenCaptureExplained: v1.screenCaptureExplained,
		completedSteps: v1.acknowledged ? [1, 2, 3, 4, 5] : [],
		version: 2
	};
}

/**
 * Get current consent data from localStorage
 * @returns ConsentData if found, null otherwise
 */
export function getConsent(): ConsentData | null {
	if (!browser) return null;

	try {
		const stored = localStorage.getItem(CONSENT_KEY);
		if (!stored) return null;

		const parsed = JSON.parse(stored);

		// Validate structure
		if (typeof parsed.acknowledged !== 'boolean') return null;

		// Migrate v1 to v2 if needed
		if (!parsed.version || parsed.version === 1) {
			const migrated = migrateV1toV2(parsed as ConsentDataV1);
			localStorage.setItem(CONSENT_KEY, JSON.stringify(migrated));
			return migrated;
		}

		return parsed as ConsentData;
	} catch {
		// JSON parse error or localStorage unavailable
		return null;
	}
}

/**
 * Save consent data to localStorage
 * @param data - Partial consent data to merge with existing
 */
export function setConsent(data: Partial<ConsentData>): void {
	if (!browser) return;

	try {
		const existing = getConsent() || { ...DEFAULT_CONSENT };
		const updated: ConsentData = {
			...existing,
			...data,
			timestamp: Date.now()
		};

		localStorage.setItem(CONSENT_KEY, JSON.stringify(updated));
	} catch {
		// localStorage may be unavailable (private browsing)
		console.warn('[consentStorage] Failed to save consent to localStorage');
	}
}

/**
 * Mark onboarding as complete
 */
export function completeOnboarding(): void {
	setConsent({
		acknowledged: true,
		webgpuInstructionsSeen: true,
		screenCaptureExplained: true
	});
}

/**
 * Check if onboarding modal should be shown
 * @returns true if user hasn't completed onboarding
 */
export function shouldShowOnboarding(): boolean {
	if (!browser) return false;

	const consent = getConsent();
	return !consent?.acknowledged;
}

/**
 * Reset consent (for testing or "show again" functionality)
 */
export function resetConsent(): void {
	if (!browser) return;

	try {
		localStorage.removeItem(CONSENT_KEY);
	} catch {
		// localStorage may be unavailable
	}
}

/**
 * Get age of consent in days
 * @returns Number of days since consent was given, or null if no consent
 */
export function getConsentAge(): number | null {
	const consent = getConsent();
	if (!consent?.acknowledged || !consent.timestamp) return null;

	const ageMs = Date.now() - consent.timestamp;
	return Math.floor(ageMs / (1000 * 60 * 60 * 24));
}

export default {
	getConsent,
	setConsent,
	completeOnboarding,
	shouldShowOnboarding,
	resetConsent,
	getConsentAge
};
