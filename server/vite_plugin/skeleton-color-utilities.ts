/**
 * Skeleton Color Utilities - Vite Plugin
 *
 * Generates CSS utilities for Skeleton v4.8+ color pairing tokens on-demand.
 * Bridges the gap between Tailwind-style utility syntax (bg-surface-100-800)
 * and Skeleton's CSS custom properties (--color-surface-100-900).
 *
 * @example
 * // vite.config.ts
 * import { skeletonColorUtilities } from './server/vite_plugin/skeleton-color-utilities';
 *
 * export default defineConfig({
 *   plugins: [
 *     skeletonColorUtilities({ debug: true }),
 *     sveltekit()
 *   ]
 * });
 *
 * @example
 * // +layout.svelte - import the generated CSS via JS (not CSS @import)
 * import 'virtual:skeleton-colors';
 */

import type { Plugin } from 'vite';

// ============================================================================
// Type Definitions
// ============================================================================

/** Available color scales in Skeleton v4.8 */
type ColorScale = 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error' | 'surface';

/** CSS property targets */
type PropertyTarget = 'bg' | 'text' | 'border' | 'divide' | 'ring' | 'placeholder';

/** Parsed utility class structure */
interface ParsedUtility {
	className: string;
	property: PropertyTarget;
	scale: ColorScale;
	lightShade: number;
	darkShade: number;
	hasOpacity: boolean;
	opacity?: number;
}

/** Plugin configuration options */
export interface SkeletonColorConfig {
	/** File extensions to scan for utility classes (default: ['.svelte', '.html']) */
	include?: string[];
	/** Generate dark mode variants using .dark selector (default: true) */
	darkMode?: boolean;
	/** Log extracted classes in dev mode (default: false) */
	debug?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const COLOR_SCALES: ColorScale[] = ['primary', 'secondary', 'tertiary', 'success', 'warning', 'error', 'surface'];
const PROPERTY_TARGETS: PropertyTarget[] = ['bg', 'text', 'border', 'divide', 'ring', 'placeholder'];

const VIRTUAL_MODULE_ID = 'virtual:skeleton-colors';
// Add .css suffix so Vite processes this as CSS, not JS
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_MODULE_ID + '.css';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a utility class name into its components
 * Supports formats:
 * - bg-surface-100-800
 * - text-primary-900-100
 * - border-error-300-700/50 (with opacity)
 */
function parseUtilityClass(className: string): ParsedUtility | null {
	// Pattern: (property)-(scale)-(lightShade)-(darkShade)(/opacity)?
	const pattern = /^(bg|text|border|divide|ring|placeholder)-([a-z]+)-(\d+)-(\d+)(?:\/(\d+))?$/;
	const match = className.match(pattern);

	if (!match) return null;

	const [, property, scale, lightShade, darkShade, opacity] = match;

	// Validate scale
	if (!COLOR_SCALES.includes(scale as ColorScale)) return null;

	// Validate property
	if (!PROPERTY_TARGETS.includes(property as PropertyTarget)) return null;

	return {
		className,
		property: property as PropertyTarget,
		scale: scale as ColorScale,
		lightShade: parseInt(lightShade, 10),
		darkShade: parseInt(darkShade, 10),
		hasOpacity: !!opacity,
		opacity: opacity ? parseInt(opacity, 10) / 100 : undefined
	};
}

/**
 * Get the CSS property name for a utility prefix
 */
function getCSSProperty(property: PropertyTarget): string {
	const map: Record<PropertyTarget, string> = {
		bg: 'background-color',
		text: 'color',
		border: 'border-color',
		divide: 'border-color',
		ring: '--tw-ring-color',
		placeholder: 'color'
	};
	return map[property];
}

/**
 * Escape special characters for CSS class selectors
 */
function escapeClassName(className: string): string {
	return className.replace(/[/:]/g, '\\$&');
}

/**
 * Generate CSS for a single utility class using explicit light/dark selectors
 */
function generatePairingCSS(parsed: ParsedUtility): string {
	const cssProperty = getCSSProperty(parsed.property);
	const escapedClass = escapeClassName(parsed.className);
	const lightVar = `--color-${parsed.scale}-${parsed.lightShade}`;
	const darkVar = `--color-${parsed.scale}-${parsed.darkShade}`;

	let css = '';

	// Special handling for placeholder pseudo-element
	if (parsed.property === 'placeholder') {
		if (parsed.hasOpacity) {
			css += `.${escapedClass}::placeholder {
  ${cssProperty}: color-mix(in oklch, var(${lightVar}) ${(parsed.opacity! * 100).toFixed(0)}%, transparent);
}
.dark .${escapedClass}::placeholder {
  ${cssProperty}: color-mix(in oklch, var(${darkVar}) ${(parsed.opacity! * 100).toFixed(0)}%, transparent);
}
`;
		} else {
			css += `.${escapedClass}::placeholder {
  ${cssProperty}: var(${lightVar});
}
.dark .${escapedClass}::placeholder {
  ${cssProperty}: var(${darkVar});
}
`;
		}
		return css;
	}

	// Special handling for divide (targets children)
	if (parsed.property === 'divide') {
		if (parsed.hasOpacity) {
			css += `.${escapedClass} > :not([hidden]) ~ :not([hidden]) {
  ${cssProperty}: color-mix(in oklch, var(${lightVar}) ${(parsed.opacity! * 100).toFixed(0)}%, transparent);
}
.dark .${escapedClass} > :not([hidden]) ~ :not([hidden]) {
  ${cssProperty}: color-mix(in oklch, var(${darkVar}) ${(parsed.opacity! * 100).toFixed(0)}%, transparent);
}
`;
		} else {
			css += `.${escapedClass} > :not([hidden]) ~ :not([hidden]) {
  ${cssProperty}: var(${lightVar});
}
.dark .${escapedClass} > :not([hidden]) ~ :not([hidden]) {
  ${cssProperty}: var(${darkVar});
}
`;
		}
		return css;
	}

	// Standard property - light mode (default) and dark mode
	if (parsed.hasOpacity) {
		css += `.${escapedClass} {
  ${cssProperty}: color-mix(in oklch, var(${lightVar}) ${(parsed.opacity! * 100).toFixed(0)}%, transparent);
}
.dark .${escapedClass} {
  ${cssProperty}: color-mix(in oklch, var(${darkVar}) ${(parsed.opacity! * 100).toFixed(0)}%, transparent);
}
`;
	} else {
		css += `.${escapedClass} {
  ${cssProperty}: var(${lightVar});
}
.dark .${escapedClass} {
  ${cssProperty}: var(${darkVar});
}
`;
	}

	return css;
}

// ============================================================================
// Main Plugin
// ============================================================================

const DEFAULT_CONFIG: Required<SkeletonColorConfig> = {
	include: ['.svelte', '.html', '.jsx', '.tsx'],
	darkMode: true,
	debug: false
};

/**
 * Vite plugin that generates CSS utilities for Skeleton color pairing tokens
 *
 * @param config - Plugin configuration options
 * @returns Vite plugin
 */
export function skeletonColorUtilities(config: SkeletonColorConfig = {}): Plugin {
	const opts = { ...DEFAULT_CONFIG, ...config };
	const extractedClasses = new Map<string, ParsedUtility>();

	return {
		name: 'skeleton-color-utilities',
		enforce: 'pre',

		/**
		 * Scan source files for utility class patterns
		 */
		transform(code, id) {
			// Only scan included file types
			if (!opts.include.some((ext) => id.endsWith(ext))) {
				return null;
			}

			// Skip node_modules
			if (id.includes('node_modules')) {
				return null;
			}

			// Multiple patterns to extract classes from various syntaxes
			const patterns = [
				// Standard class attribute: class="..."
				/class=["'`]([^"'`]+)["'`]/g,
				// Svelte class directive: class:name={condition}
				/class:([a-zA-Z0-9_-]+(?:-\d+-\d+(?:\/\d+)?)?)(?:=|\s|>)/g,
				// Template literals with expressions: class={`...`}
				/class=\{`([^`]+)`\}/g
			];

			for (const pattern of patterns) {
				const matches = code.matchAll(pattern);
				for (const match of matches) {
					const classString = match[1];
					if (!classString) continue;

					// Split by whitespace, commas, quotes, brackets
					const classes = classString.split(/[\s,'"[\]{}]+/).filter(Boolean);

					for (const cls of classes) {
						// Skip if already extracted
						if (extractedClasses.has(cls)) continue;

						const parsed = parseUtilityClass(cls);
						if (parsed) {
							extractedClasses.set(cls, parsed);
						}
					}
				}
			}

			// Don't transform the file, just extract classes
			return null;
		},

		/**
		 * Resolve the virtual module ID
		 */
		resolveId(id) {
			if (id === VIRTUAL_MODULE_ID) {
				return RESOLVED_VIRTUAL_ID;
			}
			return undefined;
		},

		/**
		 * Generate CSS for the virtual module
		 */
		load(id) {
			if (id === RESOLVED_VIRTUAL_ID) {
				// Generate CSS
				let css = `/**
 * Skeleton Color Utilities - Auto-generated
 * Generated: ${new Date().toISOString()}
 * Classes: ${extractedClasses.size}
 *
 * This file is generated by skeleton-color-utilities Vite plugin.
 * It maps Tailwind-style utility classes (bg-surface-100-800) to
 * Skeleton v4.8 CSS custom properties (--color-surface-100-900).
 */

`;

				// Sort classes for consistent output
				const sortedClasses = [...extractedClasses.entries()].sort((a, b) =>
					a[0].localeCompare(b[0])
				);

				// Generate CSS for each extracted class
				for (const [, parsed] of sortedClasses) {
					css += generatePairingCSS(parsed);
					css += '\n';
				}

				if (opts.debug) {
					console.log(`[skeleton-color-utilities] Generated ${extractedClasses.size} utility classes`);
				}

				return css;
			}
			return null;
		},

		/**
		 * Log statistics at build end
		 */
		buildEnd() {
			if (opts.debug) {
				console.log('\n[skeleton-color-utilities] Summary:');
				console.log(`   Generated ${extractedClasses.size} utility classes`);

				if (extractedClasses.size > 0) {
					// Group by property type
					const byProperty = new Map<PropertyTarget, string[]>();
					for (const [className, parsed] of extractedClasses) {
						const list = byProperty.get(parsed.property) || [];
						list.push(className);
						byProperty.set(parsed.property, list);
					}

					for (const [property, classes] of byProperty) {
						console.log(`   ${property}: ${classes.length} classes`);
					}
				}
			}
		},

		/**
		 * Hot Module Replacement support
		 */
		handleHotUpdate({ file, server }) {
			// Only handle component files we're scanning
			if (!opts.include.some((ext) => file.endsWith(ext))) {
				return;
			}

			// Invalidate virtual module to regenerate CSS
			const cssMod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
			if (cssMod) {
				server.moduleGraph.invalidateModule(cssMod);
			}
		}
	};
}

export default skeletonColorUtilities;
