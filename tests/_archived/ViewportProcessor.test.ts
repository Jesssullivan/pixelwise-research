/**
 * ViewportProcessor Unit Tests
 *
 * Comprehensive test suite for viewport-aware text processing with
 * IntersectionObserver and MutationObserver integration.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ViewportProcessor } from '$lib/pixelwise/ViewportProcessor';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();
let intersectionCallback: (entries: IntersectionObserverEntry[]) => void;

const mockIntersectionObserver = vi.fn().mockImplementation(function (
	this: IntersectionObserver,
	callback: IntersectionObserverCallback
) {
	intersectionCallback = callback;
	return {
		observe: mockObserve,
		unobserve: mockUnobserve,
		disconnect: mockDisconnect,
		root: null,
		rootMargin: '',
		thresholds: []
	};
});

// Mock MutationObserver
let mutationCallback: (mutations: MutationRecord[]) => void;
const mockMutationObserve = vi.fn();
const mockMutationDisconnect = vi.fn();

const mockMutationObserver = vi.fn().mockImplementation(function (
	this: MutationObserver,
	callback: MutationCallback
) {
	mutationCallback = callback;
	return {
		observe: mockMutationObserve,
		disconnect: mockMutationDisconnect
	};
});

// Mock requestAnimationFrame
let rafCallback: (() => void) | null = null;
const mockRequestAnimationFrame = vi.fn((cb: () => void) => {
	rafCallback = cb;
	return 1;
});

const mockCancelAnimationFrame = vi.fn();

// Mock browser environment
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('ViewportProcessor', () => {
	let onProcess: ReturnType<typeof vi.fn>;
	let onRelease: ReturnType<typeof vi.fn>;
	let processor: ViewportProcessor;

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();
		rafCallback = null;

		// Setup globals
		vi.stubGlobal('IntersectionObserver', mockIntersectionObserver);
		vi.stubGlobal('MutationObserver', mockMutationObserver);
		vi.stubGlobal('requestAnimationFrame', mockRequestAnimationFrame);
		vi.stubGlobal('cancelAnimationFrame', mockCancelAnimationFrame);

		// Create mock callbacks
		onProcess = vi.fn().mockResolvedValue(undefined);
		onRelease = vi.fn();
	});

	afterEach(() => {
		processor?.destroy();
		vi.unstubAllGlobals();
	});

	describe('Constructor', () => {
		it('should initialize with default config', () => {
			processor = new ViewportProcessor(onProcess, onRelease);

			expect(mockIntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
				root: null,
				rootMargin: '50px',
				threshold: 0.1
			});

			expect(mockMutationObserver).toHaveBeenCalledWith(expect.any(Function));
		});

		it('should accept custom threshold option', () => {
			processor = new ViewportProcessor(onProcess, onRelease, {
				threshold: 0.5
			});

			expect(mockIntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
				root: null,
				rootMargin: '50px',
				threshold: 0.5
			});
		});

		it('should accept custom rootMargin option', () => {
			processor = new ViewportProcessor(onProcess, onRelease, {
				rootMargin: '100px'
			});

			expect(mockIntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
				root: null,
				rootMargin: '100px',
				threshold: 0.1
			});
		});

		it('should accept custom batchSize option', async () => {
			processor = new ViewportProcessor(onProcess, onRelease, {
				batchSize: 5
			});

			// Create mock container
			const container = document.createElement('div');
			document.body.appendChild(container);

			// Add 10 paragraph elements
			for (let i = 0; i < 10; i++) {
				const p = document.createElement('p');
				p.textContent = `Paragraph ${i}`;
				container.appendChild(p);
			}

			processor.observe(container);

			// Simulate all elements entering viewport
			const paragraphs = container.querySelectorAll('p');
			const entries = Array.from(paragraphs).map((p) => ({
				target: p,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			}));

			intersectionCallback(entries);
			expect(processor.pendingCount).toBe(10);

			// Process first batch
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(5));

			expect(processor.pendingCount).toBe(5);

			// Cleanup
			document.body.removeChild(container);
		});

		it('should be SSR-safe (no-op when not in browser)', async () => {
			// Clear module cache to ensure fresh import
			vi.resetModules();

			// Temporarily mock browser as false
			vi.doMock('$app/environment', () => ({ browser: false }));

			// Re-stub globals after resetModules
			vi.stubGlobal('IntersectionObserver', mockIntersectionObserver);
			vi.stubGlobal('MutationObserver', mockMutationObserver);
			vi.stubGlobal('requestAnimationFrame', mockRequestAnimationFrame);
			vi.stubGlobal('cancelAnimationFrame', mockCancelAnimationFrame);

			// Clear mock call counts before assertions
			mockIntersectionObserver.mockClear();
			mockMutationObserver.mockClear();

			const { ViewportProcessor: SSRProcessor } = await import(
				'$lib/pixelwise/ViewportProcessor'
			);
			const ssrProcessor = new SSRProcessor(onProcess, onRelease);

			// Observers should not be created when browser is false
			expect(mockIntersectionObserver).not.toHaveBeenCalled();
			expect(mockMutationObserver).not.toHaveBeenCalled();

			// Methods should not throw
			expect(() => ssrProcessor.observe()).not.toThrow();
			expect(() => ssrProcessor.destroy()).not.toThrow();

			// Reset mock
			vi.doUnmock('$app/environment');
		});
	});

	describe('IntersectionObserver setup', () => {
		beforeEach(() => {
			processor = new ViewportProcessor(onProcess, onRelease);
		});

		it('should create observer with correct options', () => {
			expect(mockIntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
				root: null,
				rootMargin: '50px',
				threshold: 0.1
			});
		});

		it('should observe text elements matching selector', () => {
			const container = document.createElement('div');
			const p = document.createElement('p');
			const h1 = document.createElement('h1');
			const span = document.createElement('span');

			container.appendChild(p);
			container.appendChild(h1);
			container.appendChild(span);
			document.body.appendChild(container);

			processor.observe(container);

			// Should observe each text element
			expect(mockObserve).toHaveBeenCalledTimes(3);
			expect(mockObserve).toHaveBeenCalledWith(p);
			expect(mockObserve).toHaveBeenCalledWith(h1);
			expect(mockObserve).toHaveBeenCalledWith(span);

			// Cleanup
			document.body.removeChild(container);
		});

		it('should observe container if it matches text selector', () => {
			const container = document.createElement('p');
			const span = document.createElement('span');
			container.appendChild(span);
			document.body.appendChild(container);

			processor.observe(container);

			// Should observe both container and child
			expect(mockObserve).toHaveBeenCalledTimes(2);
			expect(mockObserve).toHaveBeenCalledWith(container);
			expect(mockObserve).toHaveBeenCalledWith(span);

			// Cleanup
			document.body.removeChild(container);
		});
	});

	describe('Element processing', () => {
		beforeEach(() => {
			processor = new ViewportProcessor(onProcess, onRelease);
		});

		it('should queue elements entering viewport', () => {
			const element = document.createElement('p');

			const entry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry]);

			expect(processor.pendingCount).toBe(1);
		});

		it('should not queue element multiple times', () => {
			const element = document.createElement('p');

			const entry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry]);
			intersectionCallback([entry]);

			expect(processor.pendingCount).toBe(1);
		});

		it('should process elements in batches', async () => {
			processor = new ViewportProcessor(onProcess, onRelease, {
				batchSize: 2
			});

			const elements = [
				document.createElement('p'),
				document.createElement('p'),
				document.createElement('p'),
				document.createElement('p')
			];

			const entries = elements.map((el) => ({
				target: el,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			}));

			intersectionCallback(entries);

			expect(processor.pendingCount).toBe(4);

			// Process first batch
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(2));
			expect(processor.pendingCount).toBe(2);

			// Process second batch
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(4));
			expect(processor.pendingCount).toBe(0);
		});

		it('should use requestAnimationFrame for scheduling', () => {
			const element = document.createElement('p');

			const entry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry]);

			expect(mockRequestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));
		});

		it('should cancel previous RAF when scheduling new one', () => {
			const element1 = document.createElement('p');
			const element2 = document.createElement('p');

			const entry1: IntersectionObserverEntry = {
				target: element1,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			const entry2: IntersectionObserverEntry = {
				target: element2,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry1]);
			intersectionCallback([entry2]);

			expect(mockCancelAnimationFrame).toHaveBeenCalledWith(1);
		});

		it('should mark element as processed after successful processing', async () => {
			const element = document.createElement('p');

			const entry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry]);
			rafCallback?.();

			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledWith(element));
			expect(processor.activeCount).toBe(1);
		});

		it('should handle processing errors gracefully', async () => {
			const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const errorElement = document.createElement('p');
			const successElement = document.createElement('p');

			onProcess.mockImplementation((el: HTMLElement) => {
				if (el === errorElement) {
					return Promise.reject(new Error('Processing failed'));
				}
				return Promise.resolve();
			});

			const entries = [
				{
					target: errorElement,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				},
				{
					target: successElement,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				}
			];

			intersectionCallback(entries);
			rafCallback?.();

			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(2));
			expect(consoleWarn).toHaveBeenCalled();

			// Success element should still be tracked
			expect(processor.activeCount).toBe(1);

			consoleWarn.mockRestore();
		});
	});

	describe('Memory management', () => {
		beforeEach(() => {
			processor = new ViewportProcessor(onProcess, onRelease);
		});

		it('should release elements leaving viewport', async () => {
			const element = document.createElement('p');

			// Enter viewport
			const enterEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([enterEntry]);
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalled());

			expect(processor.activeCount).toBe(1);

			// Leave viewport
			const leaveEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: false,
				intersectionRatio: 0,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([leaveEntry]);

			expect(processor.activeCount).toBe(0);
		});

		it('should call onRelease callback when element exits', async () => {
			const element = document.createElement('p');

			// Enter viewport
			const enterEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([enterEntry]);
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalled());

			// Leave viewport
			const leaveEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: false,
				intersectionRatio: 0,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([leaveEntry]);

			expect(onRelease).toHaveBeenCalledWith(element);
		});

		it('should clear element from activeElements Map', async () => {
			const element = document.createElement('p');

			// Enter viewport
			const enterEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([enterEntry]);
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalled());

			expect(processor.activeCount).toBe(1);

			// Leave viewport
			const leaveEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: false,
				intersectionRatio: 0,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([leaveEntry]);

			expect(processor.activeCount).toBe(0);
		});

		it('should remove from processingQueue if pending', () => {
			const element = document.createElement('p');

			// Enter viewport (queued but not processed yet)
			const enterEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([enterEntry]);
			expect(processor.pendingCount).toBe(1);

			// Leave viewport before processing
			const leaveEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: false,
				intersectionRatio: 0,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([leaveEntry]);

			expect(processor.pendingCount).toBe(0);
			expect(onRelease).toHaveBeenCalledWith(element);
		});

		it('should not release element not in viewport', () => {
			const element = document.createElement('p');

			// Element not in activeElements
			const leaveEntry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: false,
				intersectionRatio: 0,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([leaveEntry]);

			expect(onRelease).not.toHaveBeenCalled();
			expect(processor.activeCount).toBe(0);
		});
	});

	describe('MutationObserver', () => {
		beforeEach(() => {
			processor = new ViewportProcessor(onProcess, onRelease);
		});

		it('should observe DOM changes', () => {
			const container = document.createElement('div');
			document.body.appendChild(container);

			processor.observe(container);

			expect(mockMutationObserve).toHaveBeenCalledWith(container, {
				childList: true,
				subtree: true
			});

			document.body.removeChild(container);
		});

		it('should add new text elements to IntersectionObserver', () => {
			const container = document.createElement('div');
			document.body.appendChild(container);

			processor.observe(container);
			mockObserve.mockClear();

			// Simulate adding new paragraph
			const newP = document.createElement('p');
			container.appendChild(newP);

			const mutation: MutationRecord = {
				type: 'childList',
				target: container,
				addedNodes: [newP] as any,
				removedNodes: [] as any,
				previousSibling: null,
				nextSibling: null,
				attributeName: null,
				attributeNamespace: null,
				oldValue: null
			};

			mutationCallback([mutation]);

			expect(mockObserve).toHaveBeenCalledWith(newP);

			document.body.removeChild(container);
		});

		it('should cleanup removed elements', async () => {
			const container = document.createElement('div');
			const p = document.createElement('p');
			container.appendChild(p);
			document.body.appendChild(container);

			processor.observe(container);

			// Enter viewport and process
			const enterEntry: IntersectionObserverEntry = {
				target: p,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([enterEntry]);
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalled());

			expect(processor.activeCount).toBe(1);

			// Simulate removal
			container.removeChild(p);

			const mutation: MutationRecord = {
				type: 'childList',
				target: container,
				addedNodes: [] as any,
				removedNodes: [p] as any,
				previousSibling: null,
				nextSibling: null,
				attributeName: null,
				attributeNamespace: null,
				oldValue: null
			};

			mutationCallback([mutation]);

			expect(processor.activeCount).toBe(0);
			expect(onRelease).toHaveBeenCalledWith(p);

			document.body.removeChild(container);
		});

		it('should handle multiple mutations', () => {
			const container = document.createElement('div');
			document.body.appendChild(container);

			processor.observe(container);
			mockObserve.mockClear();

			const p1 = document.createElement('p');
			const p2 = document.createElement('p');

			const mutations: MutationRecord[] = [
				{
					type: 'childList',
					target: container,
					addedNodes: [p1] as any,
					removedNodes: [] as any,
					previousSibling: null,
					nextSibling: null,
					attributeName: null,
					attributeNamespace: null,
					oldValue: null
				},
				{
					type: 'childList',
					target: container,
					addedNodes: [p2] as any,
					removedNodes: [] as any,
					previousSibling: null,
					nextSibling: null,
					attributeName: null,
					attributeNamespace: null,
					oldValue: null
				}
			];

			mutationCallback(mutations);

			expect(mockObserve).toHaveBeenCalledWith(p1);
			expect(mockObserve).toHaveBeenCalledWith(p2);

			document.body.removeChild(container);
		});
	});

	describe('Getters', () => {
		beforeEach(() => {
			processor = new ViewportProcessor(onProcess, onRelease);
		});

		it('activeCount should return correct number', async () => {
			expect(processor.activeCount).toBe(0);

			const element1 = document.createElement('p');
			const element2 = document.createElement('p');

			const entries = [
				{
					target: element1,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				},
				{
					target: element2,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				}
			];

			intersectionCallback(entries);
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(2));

			expect(processor.activeCount).toBe(2);
		});

		it('pendingCount should return queue length', () => {
			expect(processor.pendingCount).toBe(0);

			const element1 = document.createElement('p');
			const element2 = document.createElement('p');
			const element3 = document.createElement('p');

			const entries = [
				{
					target: element1,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				},
				{
					target: element2,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				},
				{
					target: element3,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				}
			];

			intersectionCallback(entries);

			expect(processor.pendingCount).toBe(3);
		});
	});

	describe('Destroy method', () => {
		beforeEach(() => {
			processor = new ViewportProcessor(onProcess, onRelease);
		});

		it('should disconnect all observers', () => {
			processor.destroy();

			expect(mockDisconnect).toHaveBeenCalled();
			expect(mockMutationDisconnect).toHaveBeenCalled();
		});

		it('should release all active elements', async () => {
			const element1 = document.createElement('p');
			const element2 = document.createElement('p');

			const entries = [
				{
					target: element1,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				},
				{
					target: element2,
					isIntersecting: true,
					intersectionRatio: 0.5,
					boundingClientRect: {} as DOMRectReadOnly,
					intersectionRect: {} as DOMRectReadOnly,
					rootBounds: null,
					time: Date.now()
				}
			];

			intersectionCallback(entries);
			rafCallback?.();
			await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(2));

			expect(processor.activeCount).toBe(2);

			processor.destroy();

			expect(onRelease).toHaveBeenCalledWith(element1);
			expect(onRelease).toHaveBeenCalledWith(element2);
		});

		it('should clear all internal state', async () => {
			const element = document.createElement('p');

			const entry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry]);

			expect(processor.pendingCount).toBe(1);

			processor.destroy();

			expect(processor.activeCount).toBe(0);
			expect(processor.pendingCount).toBe(0);
		});

		it('should cancel pending RAF', () => {
			const element = document.createElement('p');

			const entry: IntersectionObserverEntry = {
				target: element,
				isIntersecting: true,
				intersectionRatio: 0.5,
				boundingClientRect: {} as DOMRectReadOnly,
				intersectionRect: {} as DOMRectReadOnly,
				rootBounds: null,
				time: Date.now()
			};

			intersectionCallback([entry]);

			expect(mockRequestAnimationFrame).toHaveBeenCalled();

			processor.destroy();

			expect(mockCancelAnimationFrame).toHaveBeenCalledWith(1);
		});

		it('should be safe to call multiple times', () => {
			expect(() => {
				processor.destroy();
				processor.destroy();
			}).not.toThrow();
		});
	});
});
