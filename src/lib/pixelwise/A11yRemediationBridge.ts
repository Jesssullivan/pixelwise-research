/**
 * A11yRemediationBridge - Connects accessibility violations to GPU compositor
 *
 * Stub implementation for type checking
 * Full implementation pending GPU compositor integration
 */

export interface RemediationTarget {
	element: HTMLElement;
	violationType: string;
	currentValue: string;
	targetValue: string;
}

export class A11yRemediationBridge {
	private active = false;

	constructor() {
		// Stub constructor
	}

	/**
	 * Start monitoring for accessibility violations
	 */
	start(): void {
		this.active = true;
	}

	/**
	 * Stop monitoring
	 */
	stop(): void {
		this.active = false;
	}

	/**
	 * Check if bridge is active
	 */
	isActive(): boolean {
		return this.active;
	}

	/**
	 * Queue element for remediation
	 */
	queueRemediation(target: RemediationTarget): void {
		// Stub - to be implemented with GPU compositor
	}

	/**
	 * Clear remediation queue
	 */
	clearQueue(): void {
		// Stub
	}
}
