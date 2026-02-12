import type { Handle } from '@sveltejs/kit';

/**
 * SvelteKit server hook — injects COOP/COEP headers on all responses.
 *
 * These headers enable cross-origin isolation (SharedArrayBuffer) required
 * by Futhark WASM multicore. Applied at the app level so they work
 * regardless of reverse proxy configuration.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
	return response;
};
