/**
 * StackingContextResolver - Z-order resolution for DOM elements
 *
 * Analyzes CSS stacking contexts to determine effective z-indices
 * for text elements, enabling proper occlusion handling in the
 * ESDT contrast enhancement pipeline.
 *
 * CSS Stacking Context Creation Triggers:
 * - position: relative/absolute/fixed/sticky with z-index != auto
 * - opacity < 1
 * - transform != none
 * - filter != none
 * - perspective != none
 * - clip-path != none
 * - mask != none
 * - isolation: isolate
 * - mix-blend-mode != normal
 * - will-change: transform, opacity, etc.
 * - contain: layout, paint, strict, content
 * - container-type != normal (CSS containment)
 *
 * @module pixelwise/StackingContextResolver
 */

/**
 * Information about a stacking context
 */
export interface StackingContextInfo {
	/** Unique ID for this stacking context */
	contextId: number;
	/** Parent stacking context ID (0 for root) */
	parentContextId: number;
	/** The element that created this context */
	element: Element | null;
	/** Base z-index of this context */
	baseZ: number;
	/** Depth in the stacking context tree */
	depth: number;
}

/**
 * Result of resolving an element's stacking position
 */
export interface StackingInfo {
	/** Unique ID for the element's stacking context */
	contextId: number;
	/** Effective z-index within the context */
	effectiveZ: number;
	/** Whether this element creates a new stacking context */
	isNewContext: boolean;
	/** Parent stacking context ID */
	parentContextId: number;
	/** Depth in stacking context tree */
	depth: number;
}

/**
 * StackingContextResolver - Resolves z-ordering for DOM elements
 *
 * @example
 * ```typescript
 * const resolver = new StackingContextResolver();
 *
 * // Get stacking info for an element
 * const info = resolver.resolve(element);
 * console.log(info.effectiveZ, info.contextId);
 *
 * // Use with GlyphExtractor
 * extractor.extractExtended(element, transformer, (el) => resolver.resolve(el));
 *
 * // Clear cache when DOM changes significantly
 * resolver.clear();
 * ```
 */
export class StackingContextResolver {
	private contextCounter = 0;
	private contextMap = new WeakMap<Element, StackingContextInfo>();
	private elementInfoCache = new WeakMap<Element, StackingInfo>();

	constructor() {
		// Root context has ID 0
		this.contextCounter = 0;
	}

	/**
	 * Resolve the stacking information for an element
	 *
	 * @param element - Element to resolve
	 * @returns Stacking information including context and effective z-index
	 */
	resolve(element: Element): StackingInfo {
		// Check cache first
		const cached = this.elementInfoCache.get(element);
		if (cached) return cached;

		const style = window.getComputedStyle(element);
		const createsContext = this.createsStackingContext(style);

		// Find or create context
		let contextId: number;
		let parentContextId = 0;
		let depth = 0;

		if (createsContext) {
			// This element creates a new stacking context
			const existingContext = this.contextMap.get(element);
			if (existingContext) {
				contextId = existingContext.contextId;
				parentContextId = existingContext.parentContextId;
				depth = existingContext.depth;
			} else {
				// Find parent context
				const parentInfo = this.findParentContext(element);
				parentContextId = parentInfo.contextId;
				depth = parentInfo.depth + 1;

				// Create new context
				contextId = ++this.contextCounter;
				this.contextMap.set(element, {
					contextId,
					parentContextId,
					element,
					baseZ: this.getZIndex(style),
					depth
				});
			}
		} else {
			// Inherit from nearest ancestor with stacking context
			const parentInfo = this.findParentContext(element);
			contextId = parentInfo.contextId;
			parentContextId = parentInfo.parentContextId;
			depth = parentInfo.depth;
		}

		const effectiveZ = this.getZIndex(style);

		const info: StackingInfo = {
			contextId,
			effectiveZ,
			isNewContext: createsContext,
			parentContextId,
			depth
		};

		this.elementInfoCache.set(element, info);
		return info;
	}

	/**
	 * Check if an element creates a new stacking context
	 */
	createsStackingContext(style: CSSStyleDeclaration): boolean {
		// Position with z-index
		const position = style.position;
		const zIndex = style.zIndex;
		if ((position === 'relative' || position === 'absolute' || position === 'fixed' || position === 'sticky') && zIndex !== 'auto') {
			return true;
		}

		// Opacity < 1
		if (parseFloat(style.opacity) < 1) {
			return true;
		}

		// Transform
		if (style.transform !== 'none') {
			return true;
		}

		// Filter
		if (style.filter !== 'none') {
			return true;
		}

		// Perspective
		if (style.perspective !== 'none') {
			return true;
		}

		// Clip-path
		if (style.clipPath !== 'none') {
			return true;
		}

		// Mask
		const mask = (style as CSSStyleDeclaration & { mask?: string }).mask;
		if (mask && mask !== 'none') {
			return true;
		}

		// Isolation
		if (style.isolation === 'isolate') {
			return true;
		}

		// Mix-blend-mode
		if (style.mixBlendMode !== 'normal') {
			return true;
		}

		// Will-change
		const willChange = style.willChange;
		if (willChange && (willChange.includes('transform') || willChange.includes('opacity') || willChange.includes('filter') || willChange.includes('backdrop-filter'))) {
			return true;
		}

		// Contain
		const contain = style.contain;
		if (contain && (contain.includes('layout') || contain.includes('paint') || contain.includes('strict') || contain.includes('content'))) {
			return true;
		}

		// Container-type
		const containerType = (style as CSSStyleDeclaration & { containerType?: string }).containerType;
		if (containerType && containerType !== 'normal') {
			return true;
		}

		// Backdrop-filter
		const backdropFilter = (style as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter;
		if (backdropFilter && backdropFilter !== 'none') {
			return true;
		}

		return false;
	}

	/**
	 * Find the nearest ancestor that creates a stacking context
	 */
	private findParentContext(element: Element): StackingContextInfo {
		let parent = element.parentElement;

		while (parent) {
			const existingContext = this.contextMap.get(parent);
			if (existingContext) {
				return existingContext;
			}

			const style = window.getComputedStyle(parent);
			if (this.createsStackingContext(style)) {
				// Create and cache this context
				const parentOfParent = this.findParentContext(parent);
				const contextId = ++this.contextCounter;
				const contextInfo: StackingContextInfo = {
					contextId,
					parentContextId: parentOfParent.contextId,
					element: parent,
					baseZ: this.getZIndex(style),
					depth: parentOfParent.depth + 1
				};
				this.contextMap.set(parent, contextInfo);
				return contextInfo;
			}

			parent = parent.parentElement;
		}

		// Root context
		return {
			contextId: 0,
			parentContextId: 0,
			element: null,
			baseZ: 0,
			depth: 0
		};
	}

	/**
	 * Get z-index from computed style, defaulting to 0 for 'auto'
	 */
	private getZIndex(style: CSSStyleDeclaration): number {
		const z = style.zIndex;
		if (z === 'auto' || z === '') {
			return 0;
		}
		return parseInt(z, 10) || 0;
	}

	/**
	 * Compute a global sort key for z-ordering across all contexts
	 *
	 * This creates a composite key that respects the stacking context hierarchy.
	 * Elements are sorted by: context depth, then context creation order, then z-index.
	 *
	 * @param info - Stacking information
	 * @returns Numeric sort key (higher = in front)
	 */
	computeSortKey(info: StackingInfo): number {
		// Combine depth, context ID, and z-index into a sortable key
		// Format: depth (8 bits) | contextId (16 bits) | zIndex (16 bits, signed shifted)
		const depth = Math.min(255, info.depth);
		const contextId = Math.min(65535, info.contextId);
		const zIndex = Math.max(-32768, Math.min(32767, info.effectiveZ)) + 32768;

		return (depth << 32) | (contextId << 16) | zIndex;
	}

	/**
	 * Get all stacking contexts as an array (for debugging/visualization)
	 */
	getContexts(): StackingContextInfo[] {
		// WeakMap doesn't support iteration, so we need to traverse the DOM
		// This is mainly for debugging
		const contexts: StackingContextInfo[] = [];

		const walk = (element: Element) => {
			const ctx = this.contextMap.get(element);
			if (ctx) {
				contexts.push(ctx);
			}
			for (const child of element.children) {
				walk(child);
			}
		};

		if (typeof document !== 'undefined') {
			walk(document.body);
		}

		return contexts.sort((a, b) => a.contextId - b.contextId);
	}

	/**
	 * Clear cached data
	 *
	 * Call this when the DOM structure changes significantly
	 */
	clear(): void {
		// WeakMap clears itself when elements are GC'd
		// Just reset the counter for fresh IDs
		this.contextCounter = 0;
		this.contextMap = new WeakMap();
		this.elementInfoCache = new WeakMap();
	}

	/**
	 * Invalidate cache for a specific element and its descendants
	 *
	 * Call this when an element's styles change
	 */
	invalidate(element: Element): void {
		this.elementInfoCache.delete(element);
		this.contextMap.delete(element);

		// Also invalidate descendants
		for (const child of element.children) {
			this.invalidate(child);
		}
	}
}

/**
 * Global singleton resolver for convenience
 */
let globalResolver: StackingContextResolver | null = null;

/**
 * Get or create the global StackingContextResolver
 */
export function getStackingContextResolver(): StackingContextResolver {
	if (!globalResolver) {
		globalResolver = new StackingContextResolver();
	}
	return globalResolver;
}

/**
 * Quick resolution of stacking info for an element
 */
export function resolveStackingContext(element: Element): StackingInfo {
	return getStackingContextResolver().resolve(element);
}

/**
 * Pack stacking context data for GPU upload
 *
 * @param contexts - Array of stacking context info
 * @returns Uint32Array with [contextId0, parentId0, baseZ0, ...]
 */
export function packStackingContextsForGPU(contexts: StackingContextInfo[]): Uint32Array {
	const result = new Uint32Array(contexts.length * 3);

	for (let i = 0; i < contexts.length; i++) {
		const ctx = contexts[i];
		result[i * 3] = ctx.contextId;
		result[i * 3 + 1] = ctx.parentContextId;
		// Shift z-index to unsigned range
		result[i * 3 + 2] = ctx.baseZ + 2147483648; // Add 2^31
	}

	return result;
}
