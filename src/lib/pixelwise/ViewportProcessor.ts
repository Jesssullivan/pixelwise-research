/**
 * ViewportProcessor - Viewport-aware automatic text processing
 *
 * Uses IntersectionObserver to automatically process text elements as they
 * enter the viewport and release memory when they leave. Integrates with
 * MutationObserver for SPA navigation support.
 *
 * Memory Model:
 * - Only elements currently in viewport are tracked (~20-50 elements)
 * - Elements leaving viewport are released and removed from tracking
 * - Processing is batched and throttled to prevent frame drops
 *
 * @module ViewportProcessor
 */

import { browser } from '$app/environment';

/**
 * State tracking for processed elements
 */
export interface CorrectionState {
	/** Whether element has been processed */
	processed: boolean;
	/** Timestamp when element was processed */
	timestamp: number;
}

/**
 * Configuration options for ViewportProcessor
 */
export interface ViewportProcessorOptions {
	/** Visibility threshold (0-1) for IntersectionObserver */
	threshold?: number;
	/** Root margin for pre-processing before entering viewport */
	rootMargin?: string;
	/** Maximum elements to process per animation frame */
	batchSize?: number;
	/** Container element to observe (defaults to document.body) */
	container?: HTMLElement;
}

/**
 * Text element selector for viewport processing
 * Targets all elements that typically contain user-visible text
 */
const TEXT_ELEMENT_SELECTOR =
	'p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, label, button, ' +
	'[role="heading"], [role="link"], [role="button"]';

/**
 * Viewport-aware text processor
 *
 * Uses IntersectionObserver to:
 * 1. Automatically process text elements entering viewport
 * 2. Release memory for elements leaving viewport
 * 3. Throttle processing for smooth scrolling
 * 4. Handle dynamic content with MutationObserver
 *
 * @example
 * ```typescript
 * const processor = new ViewportProcessor(
 *   async (element) => {
 *     // Process element
 *     await processElement(element);
 *   },
 *   (element) => {
 *     // Release element resources
 *     clearCorrections(element);
 *   }
 * );
 *
 * processor.observe(document.body);
 *
 * // Later, cleanup
 * processor.destroy();
 * ```
 */
export class ViewportProcessor {
	private observer: IntersectionObserver | null = null;
	private mutationObserver: MutationObserver | null = null;
	private activeElements = new Map<HTMLElement, CorrectionState>();
	private processingQueue: HTMLElement[] = [];
	private isProcessing = false;
	private rafId: number | null = null;

	// CRITICAL: Guard flag to prevent race conditions
	// Fixes "Worker terminated" error caused by processQueue() running after destroy()
	private isDestroyed = false;

	// Configuration
	private readonly threshold: number;
	private readonly rootMargin: string;
	private readonly batchSize: number;

	constructor(
		private onProcess: (element: HTMLElement) => Promise<void>,
		private onRelease: (element: HTMLElement) => void,
		options: ViewportProcessorOptions = {}
	) {
		this.threshold = options.threshold ?? 0.1; // 10% visible
		this.rootMargin = options.rootMargin ?? '50px'; // Process 50px before entering viewport
		this.batchSize = options.batchSize ?? 10; // Max 10 elements per frame

		if (!browser) return;

		this.setupObserver();
		this.setupMutationObserver();
	}

	/**
	 * Initialize IntersectionObserver for viewport tracking
	 */
	private setupObserver(): void {
		this.observer = new IntersectionObserver(
			(entries) => this.handleIntersection(entries),
			{
				root: null, // Use viewport as root
				rootMargin: this.rootMargin,
				threshold: this.threshold
			}
		);
	}

	/**
	 * Initialize MutationObserver for dynamic content (SPA navigation)
	 */
	private setupMutationObserver(): void {
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					// New nodes added - check for text elements
					mutation.addedNodes.forEach((node) => {
						if (node instanceof HTMLElement) {
							this.observeTextElements(node);
						}
					});

					// Nodes removed - cleanup if being tracked
					mutation.removedNodes.forEach((node) => {
						if (node instanceof HTMLElement && this.activeElements.has(node)) {
							this.releaseElement(node);
						}
					});
				}
			}
		});
	}

	/**
	 * Handle intersection events (elements entering/leaving viewport)
	 */
	private handleIntersection(entries: IntersectionObserverEntry[]): void {
		// Guard against processing after destroy
		if (this.isDestroyed) return;

		for (const entry of entries) {
			const element = entry.target as HTMLElement;

			if (entry.isIntersecting) {
				// Element entering viewport - queue for processing
				if (!this.activeElements.has(element)) {
					this.queueForProcessing(element);
				}
			} else {
				// Element leaving viewport - release memory
				if (this.activeElements.has(element)) {
					this.releaseElement(element);
				} else {
					// Also remove from queue if pending but not yet processed
					const idx = this.processingQueue.indexOf(element);
					if (idx > -1) {
						this.processingQueue.splice(idx, 1);
						this.onRelease(element);
					}
				}
			}
		}

		// Schedule batch processing if queue is not empty
		if (this.processingQueue.length > 0) {
			this.scheduleProcessing();
		}
	}

	/**
	 * Add element to processing queue
	 */
	private queueForProcessing(element: HTMLElement): void {
		if (!this.processingQueue.includes(element)) {
			this.processingQueue.push(element);
			// Only log every 50 elements to reduce console spam
			if (this.processingQueue.length % 50 === 0) {
				console.debug(
					`[ViewportProcessor] Queue milestone: ${this.processingQueue.length} elements`
				);
			}
		}
	}

	/**
	 * Process queued elements in batches
	 */
	private async processQueue(): Promise<void> {
		// CRITICAL: Guard against processing after destroy()
		// This prevents "Worker terminated" errors from race conditions
		if (this.isDestroyed) {
			console.debug('[ViewportProcessor] processQueue() called after destroy, ignoring');
			return;
		}

		if (this.isProcessing || this.processingQueue.length === 0) return;

		this.isProcessing = true;

		// Process in batches to prevent frame drops
		const batch = this.processingQueue.splice(0, this.batchSize);

		// Silent processing - only log on significant batches
		// console.debug(`[ViewportProcessor] Processing batch of ${batch.length} elements`);

		for (const element of batch) {
			try {
				await this.onProcess(element);
				this.activeElements.set(element, {
					processed: true,
					timestamp: Date.now()
				});
			} catch (error) {
				console.warn('[ViewportProcessor] Failed to process element:', error);
			}
		}

		this.isProcessing = false;

		// Continue processing if more in queue
		if (this.processingQueue.length > 0) {
			this.scheduleProcessing();
		}
	}

	/**
	 * Schedule batch processing on next animation frame
	 */
	private scheduleProcessing(): void {
		// Guard against scheduling after destroy
		if (this.isDestroyed) return;

		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
		}

		this.rafId = requestAnimationFrame(() => {
			// Double-check destruction state in callback
			if (!this.isDestroyed) {
				this.processQueue();
			}
		});
	}

	/**
	 * Release element resources and remove from tracking
	 */
	private releaseElement(element: HTMLElement): void {
		this.activeElements.delete(element);
		this.onRelease(element);

		// Remove from queue if pending
		const idx = this.processingQueue.indexOf(element);
		if (idx > -1) {
			this.processingQueue.splice(idx, 1);
		}

		// Silent release - don't log every element
		// console.debug(`[ViewportProcessor] Released element (active: ${this.activeElements.size})`);
	}

	/**
	 * Observe text elements within a container
	 */
	private observeTextElements(root: HTMLElement): void {
		if (!this.observer) return;

		const textElements = root.querySelectorAll<HTMLElement>(TEXT_ELEMENT_SELECTOR);
		textElements.forEach((el) => this.observer!.observe(el));

		// Also check if root itself is a text element
		if (root.matches(TEXT_ELEMENT_SELECTOR)) {
			this.observer.observe(root);
		}
	}

	/**
	 * Start observing all text elements in container
	 * @param container - Container element to observe (defaults to document.body)
	 */
	observe(container: HTMLElement = document.body): void {
		if (!this.observer || !this.mutationObserver) return;

		// Observe all existing text elements
		this.observeTextElements(container);

		// Start observing for dynamic content changes
		this.mutationObserver.observe(container, {
			childList: true,
			subtree: true
		});

		const textElements = container.querySelectorAll<HTMLElement>(TEXT_ELEMENT_SELECTOR);
		console.log(`[ViewportProcessor] Observing ${textElements.length} text elements`);
	}

	/**
	 * Stop observing and cleanup all resources
	 */
	destroy(): void {
		// CRITICAL: Set destroyed flag FIRST to prevent race conditions
		// This ensures processQueue() and handleIntersection() exit early
		this.isDestroyed = true;

		// Cancel any pending RAF
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}

		// Disconnect observers
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}

		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}

		// Release all active elements
		for (const element of this.activeElements.keys()) {
			this.onRelease(element);
		}

		this.activeElements.clear();
		this.processingQueue = [];

		console.log('[ViewportProcessor] Destroyed');
	}

	/**
	 * Get count of currently active (in-viewport) elements
	 */
	get activeCount(): number {
		return this.activeElements.size;
	}

	/**
	 * Get count of pending elements in processing queue
	 */
	get pendingCount(): number {
		return this.processingQueue.length;
	}
}
