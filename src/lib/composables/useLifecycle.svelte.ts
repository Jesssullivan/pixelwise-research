/**
 * useLifecycle - Svelte 5 composable for browser lifecycle events
 *
 * Provides a simple API for attaching event listeners that are
 * automatically cleaned up when the component is destroyed.
 */

import { browser } from '$app/environment';
import { onDestroy } from 'svelte';

export interface UseLifecycleResult {
	/**
	 * Add an event listener that will be removed on component destroy
	 */
	addEventListener: (event: string, handler: EventListener) => void;

	/**
	 * Remove a previously added event listener
	 */
	removeEventListener: (event: string, handler: EventListener) => void;
}

/**
 * Create a lifecycle manager for browser events
 */
export function useLifecycle(): UseLifecycleResult {
	if (!browser) {
		// SSR stub
		return {
			addEventListener: () => {},
			removeEventListener: () => {}
		};
	}

	const listeners: Array<{ event: string; handler: EventListener }> = [];

	function addEventListener(event: string, handler: EventListener): void {
		window.addEventListener(event, handler);
		listeners.push({ event, handler });
	}

	function removeEventListener(event: string, handler: EventListener): void {
		window.removeEventListener(event, handler);
		const index = listeners.findIndex(l => l.event === event && l.handler === handler);
		if (index !== -1) {
			listeners.splice(index, 1);
		}
	}

	// Clean up all listeners when component is destroyed
	onDestroy(() => {
		listeners.forEach(({ event, handler }) => {
			window.removeEventListener(event, handler);
		});
	});

	return {
		addEventListener,
		removeEventListener
	};
}
