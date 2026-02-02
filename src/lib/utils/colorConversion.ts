/**
 * Color conversion utilities for OKLCH color space
 *
 * Simple implementations for ColorNormalizer fallback paths
 */

export interface OklchColor {
	l: number; // Lightness [0, 1]
	c: number; // Chroma [0, ~0.4]
	h: number; // Hue [0, 360]
	alpha?: number; // Alpha [0, 1]
}

/**
 * Parse OKLCH color string to components
 * Format: oklch(L C H) or oklch(L C H / alpha)
 */
export function parseOklch(color: string): OklchColor | null {
	// Match oklch(L C H) or oklch(L C H / alpha)
	const match = color.match(/oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)/i);

	if (!match) return null;

	const l = parseFloat(match[1]) / (match[1].includes('%') ? 100 : 1);
	const c = parseFloat(match[2]);
	const h = parseFloat(match[3]);
	const alpha = match[4] ? parseFloat(match[4]) / (match[4].includes('%') ? 100 : 1) : 1;

	return { l, c, h, alpha };
}

/**
 * Convert OKLCH to RGB
 * Simplified conversion - for production, use CSS Color Module Level 4 conversions
 *
 * @returns RGB tuple [r, g, b] in 0-255 range
 */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
	// Convert OKLCH -> Oklab -> Linear RGB -> sRGB
	// This is a simplified approximation

	// OKLCH to Oklab
	const hRad = (h * Math.PI) / 180;
	const a = c * Math.cos(hRad);
	const b = c * Math.sin(hRad);

	// Oklab to linear RGB (simplified matrix)
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

	const l3 = l_ * l_ * l_;
	const m3 = m_ * m_ * m_;
	const s3 = s_ * s_ * s_;

	const r_linear = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
	const g_linear = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
	const b_linear = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

	// Linear RGB to sRGB
	const toSrgb = (c: number): number => {
		c = Math.max(0, Math.min(1, c));
		return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
	};

	const r = Math.round(toSrgb(r_linear) * 255);
	const g = Math.round(toSrgb(g_linear) * 255);
	const b_srgb = Math.round(toSrgb(b_linear) * 255);

	return [r, g, b_srgb];
}
