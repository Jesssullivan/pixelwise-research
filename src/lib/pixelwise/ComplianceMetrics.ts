/**
 * ComplianceMetrics - Tracks WCAG compliance and performance
 * Provides real-time monitoring of accessibility metrics
 */
export class ComplianceMetrics {
	private wcagLevel: 'AA' | 'AAA';
	private contrastHistory: number[] = [];
	private frameTimes: number[] = [];
	private luminanceHistory: number[] = [];

	constructor(wcagLevel: 'AA' | 'AAA' = 'AA') {
		this.wcagLevel = wcagLevel;
	}

	/**
	 * Records a contrast ratio measurement
	 * @param contrast - WCAG contrast ratio (typically 1-21)
	 */
	recordContrast(contrast: number): void {
		this.contrastHistory.push(contrast);

		// Keep last 60 measurements
		if (this.contrastHistory.length > 60) {
			this.contrastHistory.shift();
		}
	}

	/**
	 * Records a frame time measurement
	 * @param time - Frame time in milliseconds
	 */
	recordFrameTime(time: number): void {
		this.frameTimes.push(time);

		// Keep last 60 measurements
		if (this.frameTimes.length > 60) {
			this.frameTimes.shift();
		}
	}

	/**
	 * Records a luminance measurement
	 * @param luminance - WCAG relative luminance (0-1)
	 */
	recordLuminance(luminance: number): void {
		this.luminanceHistory.push(luminance);

		// Keep last 60 measurements
		if (this.luminanceHistory.length > 60) {
			this.luminanceHistory.shift();
		}
	}

	/**
	 * Gets current WCAG compliance percentage
	 * @returns Compliance percentage (0-1)
	 */
	getCompliance(): number {
		if (this.contrastHistory.length === 0) return 1.0;

		const minContrast = this.wcagLevel === 'AA' ? 4.5 : 7.0;
		const compliant = this.contrastHistory.filter((c) => c >= minContrast);
		return compliant.length / this.contrastHistory.length;
	}

	/**
	 * Gets average contrast ratio
	 * @returns Average contrast ratio
	 */
	getAverageContrast(): number {
		if (this.contrastHistory.length === 0) return 0;

		const sum = this.contrastHistory.reduce((a, b) => a + b, 0);
		return sum / this.contrastHistory.length;
	}

	/**
	 * Gets minimum contrast ratio
	 * @returns Minimum contrast ratio
	 */
	getMinContrast(): number {
		if (this.contrastHistory.length === 0) return 0;
		return Math.min(...this.contrastHistory);
	}

	/**
	 * Gets maximum contrast ratio
	 * @returns Maximum contrast ratio
	 */
	getMaxContrast(): number {
		if (this.contrastHistory.length === 0) return 0;
		return Math.max(...this.contrastHistory);
	}

	/**
	 * Gets average luminance
	 * @returns Average WCAG relative luminance (0-1)
	 */
	getAverageLuminance(): number {
		if (this.luminanceHistory.length === 0) return 0.5;

		const sum = this.luminanceHistory.reduce((a, b) => a + b, 0);
		return sum / this.luminanceHistory.length;
	}

	/**
	 * Gets average frame time
	 * @returns Average frame time in milliseconds
	 */
	getAverageFrameTime(): number {
		if (this.frameTimes.length === 0) return 0;

		const sum = this.frameTimes.reduce((a, b) => a + b, 0);
		return sum / this.frameTimes.length;
	}

	/**
	 * Gets FPS based on frame times
	 * @returns Current FPS
	 */
	getFPS(): number {
		if (this.frameTimes.length === 0) return 60;

		const avgTime = this.getAverageFrameTime();
		return avgTime > 0 ? 1000 / avgTime : 60;
	}

	/**
	 * Calculates WCAG relative luminance from RGB values
	 * @param r - Red channel (0-255)
	 * @param g - Green channel (0-255)
	 * @param b - Blue channel (0-255)
	 * @returns Relative luminance (0-1)
	 */
	static calculateLuminance(r: number, g: number, b: number): number {
		// Normalize to 0-1 range
		const R = r / 255;
		const G = g / 255;
		const B = b / 255;

		// Apply sRGB to linear conversion
		const R_linear = R <= 0.03928 ? R / 12.92 : Math.pow((R + 0.055) / 1.055, 2.4);
		const G_linear = G <= 0.03928 ? G / 12.92 : Math.pow((G + 0.055) / 1.055, 2.4);
		const B_linear = B <= 0.03928 ? B / 12.92 : Math.pow((B + 0.055) / 1.055, 2.4);

		// WCAG luminance formula
		return 0.2126 * R_linear + 0.7152 * G_linear + 0.0722 * B_linear;
	}

	/**
	 * Calculates WCAG contrast ratio between two colors
	 * @param luminance1 - Luminance of color 1 (0-1)
	 * @param luminance2 - Luminance of color 2 (0-1)
	 * @returns Contrast ratio (typically 1-21)
	 */
	static calculateContrastRatio(luminance1: number, luminance2: number): number {
		const L1 = Math.max(luminance1, luminance2);
		const L2 = Math.min(luminance1, luminance2);
		return (L1 + 0.05) / (L2 + 0.05);
	}

	/**
	 * Checks if a contrast ratio meets WCAG AA standard
	 * @param contrast - Contrast ratio
	 * @returns True if meets AA (4.5:1)
	 */
	static isAACompliant(contrast: number): boolean {
		return contrast >= 4.5;
	}

	/**
	 * Checks if a contrast ratio meets WCAG AAA standard
	 * @param contrast - Contrast ratio
	 * @returns True if meets AAA (7.0:1)
	 */
	static isAAACompliant(contrast: number): boolean {
		return contrast >= 7.0;
	}

	/**
	 * Gets comprehensive metrics report
	 * @returns Metrics object with all tracked values
	 */
	getMetrics(): {
		wcagLevel: 'AA' | 'AAA';
		contrastRatio: number;
		minContrast: number;
		maxContrast: number;
		compliance: number;
		averageLuminance: number;
		frameTime: number;
		fps: number;
	} {
		return {
			wcagLevel: this.wcagLevel,
			contrastRatio: this.getAverageContrast(),
			minContrast: this.getMinContrast(),
			maxContrast: this.getMaxContrast(),
			compliance: this.getCompliance(),
			averageLuminance: this.getAverageLuminance(),
			frameTime: this.getAverageFrameTime(),
			fps: this.getFPS()
		};
	}

	/**
	 * Resets all metrics
	 */
	reset(): void {
		this.contrastHistory = [];
		this.frameTimes = [];
		this.luminanceHistory = [];
	}

	/**
	 * Destroys the metrics tracker
	 */
	destroy(): void {
		this.reset();
	}
}
