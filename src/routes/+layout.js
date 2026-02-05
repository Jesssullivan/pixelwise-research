// Disable SSR for WebGPU app - WebGPU APIs are browser-only
// Also works around Vite 8 beta SSR module runner timeout issues
export const ssr = false;

// Enable prerendering where possible
export const prerender = false;

// Always use client-side rendering
export const csr = true;
