import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { skeletonColorUtilities } from './server/vite_plugin/skeleton-color-utilities';
import wasm from 'vite-plugin-wasm';
// Note: vite-plugin-top-level-await not needed with Vite 8/Rolldown - native support

// tRPC + OpenTelemetry replaces old WebSocket plugin
// Accessibility plugin import removed - not currently in use

// Plugin to patch sveltekit-superforms to avoid SuperDebug runes mode issue
function superformsPatchPlugin(): Plugin {
	return {
		name: 'superforms-patch',
		enforce: 'pre',
		transform(code, id) {
			// Patch the main sveltekit-superforms index to not import SuperDebug
			if (id.includes('sveltekit-superforms/dist/index.js')) {
				// Replace the import with a stub
				code = code.replace(
					/import SuperDebug from '\.\/client\/SuperDebug\.svelte';?/g,
					'const SuperDebug = null;'
				);
				
				// This way the export will still work, but SuperDebug will be null
				// which is safe since we don't use it
				
				return {
					code,
					map: null
				};
			}
			return null;
		}
	};
}

// Skeleton-Tailwind v4 compatibility plugin ;)
function skeletonTailwindV4Compat(): Plugin {
	return {
		name: 'skeleton-tailwind-v4-compat',
		enforce: 'pre',
		transform(code, id) {
			// Patch Skeleton CSS to work with Tailwind v4, meheeerg blarg
			if (id.includes('@skeletonlabs/skeleton') && id.endsWith('.css')) {
				code = code
					.replace(/@variant\s+sm\s*{/g, '@media (min-width: 640px) {')
					.replace(/@variant\s+md\s*{/g, '@media (min-width: 768px) {')
					.replace(/@variant\s+lg\s*{/g, '@media (min-width: 1024px) {')
					.replace(/@variant\s+xl\s*{/g, '@media (min-width: 1280px) {')
					.replace(/@variant\s+2xl\s*{/g, '@media (min-width: 1536px) {')
					.replace(/@variant\s+dark\s*{/g, '.dark & {')
					.replace(/@apply\s+variant-/g, '@apply ');
				return {
					code,
					map: null
				};
			}
			
			// Also handle skeleton-variants.css file to ensure it's processed
			if (id.includes('skeleton-variants.css')) {
				return {
					code,
					map: null
				};
			}
		}
	};
}

// Plugin to set required headers for SharedArrayBuffer (Futhark WASM multicore)
// COOP/COEP headers enable cross-origin isolation which is required for:
// - SharedArrayBuffer (Futhark's multicore scheduler uses this for workers)
// - High-resolution timers (performance.now() with microsecond precision)
function crossOriginIsolationPlugin(): Plugin {
	return {
		name: 'cross-origin-isolation',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				// CRITICAL: These headers enable SharedArrayBuffer for Futhark WASM multicore
				res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
				// Also set permissions policy
				res.setHeader('Permissions-Policy', 'accelerometer=(self), gyroscope=(self), magnetometer=()');
				next();
			});
		}
	};
}



export default defineConfig(({ mode }) => {
	const isDev = mode === 'development';
	const isContainer = !!process.env.CONTAINER;

	return {
		ssr: {
			// Externalize problematic modules to avoid ES interop issues
			format: 'esm',
			// Vite 8 beta workaround: increase module runner timeout for slow CSS processing
			// The default 60s timeout is too short for complex CSS with Tailwind v4
			// @ts-ignore - Vite 8 beta API
			moduleRunnerTimeoutMs: 120000, // 120 seconds
			// OpenTelemetry: Most packages can be bundled, but some must be external
			// Bundle these to avoid pnpm symlink issues:
			noExternal: [
				'@opentelemetry/api',
				'@opentelemetry/sdk-trace-base',
				'@opentelemetry/sdk-trace-web',
				'@opentelemetry/semantic-conventions'
			],
			// Handle WASM files - ensure they're served as static assets, not bundled
			assetsInclude: ['**/*.wasm'],
			// Worker configuration for WASM loading
			worker: {
				format: 'es' // ES modules for workers to support WASM imports
			},
			// Externalize these due to Node.js-specific code (require, class constructors):
			external: [
				'gray-matter',
				'@fingerprintjs/fingerprintjs',
				'cssstyle',
				'jsdom',
				'@opentelemetry/resources', // Has require() calls
				'@opentelemetry/sdk-node', // Has CommonJS class constructor issues
				'@opentelemetry/exporter-trace-otlp-http', // Has OTLPExporterNodeBase class issues
				'@opentelemetry/exporter-logs-otlp-http', // Has OTLPExporterNodeBase class issues
				'@opentelemetry/exporter-prometheus', // Has Node.js-specific networking
				'@opentelemetry/auto-instrumentations-node', // Auto-instrumentations for Node.js
				'@pyroscope/nodejs' // Pyroscope profiling SDK
			]
		},
		define: {
			'window.__DEV__': isDev,
			'import.meta.env.SSR': isContainer ? 'false' : undefined,
			__NAME__: `"stonewall-underground"`,
			__VERSION__: `"${process.env.npm_package_version || '1.0.0'}"`,
			// Remove problematic CommonJS polyfills - handle externally
		},

		// Worker configuration for WASM support
		// Vite 8/Rolldown has native top-level await support
		worker: {
			format: 'es',
			plugins: () => [wasm()]
		},

		// Remove problematic CommonJS polyfill plugin - externalize instead
		plugins: [
			superformsPatchPlugin(), // Patch superforms FIRST to avoid runes mode issues
			wasm(),
			crossOriginIsolationPlugin(), // COOP/COEP headers for SharedArrayBuffer (Futhark WASM multicore)
			skeletonTailwindV4Compat(),
			skeletonColorUtilities({ debug: true }), // Generate CSS for bg-surface-X-Y utilities
			tailwindcss(),
			// DISABLED: Accessibility plugin causing memory overflow on admin bootstrap
			// Re-enable after optimizing for lower memory usage
			// accessibilityPlugin({
			// 	enabled: true,
			// 	failOnError: process.env.NODE_ENV === 'production',
			// 	wcagLevel: 'AA',
			// 	runPropertyTests: false,
			// 	reportPath: './accessibility-report.md'
			// }),
			sveltekit(),
			// Bundle analysis visualization removed - use: npm run build locally
			// rollup-plugin-visualizer not included in container dependencies
		],
		
		server: {
			// SECURITY: Force access through Caddy by restricting bindings
			host: isContainer ? '0.0.0.0' : '127.0.0.1', // Container needs 0.0.0.0 for internal networking
			port: parseInt(process.env.PORT || process.env.VITE_PORT || '5175'),
			strictPort: true, // Fail if port is in use
			// CRITICAL: Only allow Caddy container and self-references to connect
			// Using pw-* names to match podman-compose.yml service names
			allowedHosts: isContainer ? ['pw-caddy', 'pw-app', 'localhost', '127.0.0.1'] : [],
			cors: false, // Disable CORS - Caddy will handle this
			// Middleware to reject direct access and redirect to Caddy
			middlewareMode: false,
			headers: {
				// CRITICAL: Enable SharedArrayBuffer for Futhark WASM multicore
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'credentialless',
				'Permissions-Policy': 'accelerometer=(self), gyroscope=(self), magnetometer=()'
			},
			hmr: isDev && process.env.DISABLE_HMR !== 'true'
				? isContainer
					? {
						protocol: 'ws',
						host: '0.0.0.0', // Bind to all interfaces in container
						port: parseInt(process.env.HMR_PORT || '24679'), // Dedicated HMR port (differs from tinyland's 24678)
						overlay: true,
					}
					: true
				: false,
			
			watch: {
				usePolling: isDev && isContainer,
				interval: 1000, // Increased from 100ms to reduce CPU usage
				ignored: [
					'**/content/**', // Ignore all content directories
					'**/.swarm/**',
					'**/logs/**',
					'**/node_modules/**',
					'**/static/**', // Ignore all static files
					'**/futhark/*.c', // Ignore Futhark C output (rebuilt via make)
					'**/futhark/*.wasm', // Ignore Futhark WASM output
					'**/*.log',
					'**/.DS_Store',
					'**/.git/**',
					'**/dist/**',
					'**/.svelte-kit/**',
					'**/*.css.map', // Ignore CSS source maps
					'**/tailwind.gen.css' // Ignore generated Tailwind files
				]
			},
			
			fs: {
				strict: false,
				allow: [
					'..',
					'./src/content',
					'/app',
					'./themes',
					'./static',
					'./scripts'
				]
			}
		},
		
		optimizeDeps: {
			include: [
				'marked',
				'@iconify/svelte'
			],
			exclude: [
				'@sveltejs/kit',
				'svelte',
				'mdsvex',
				'@skeletonlabs/skeleton',
				'sveltekit-superforms' // Exclude entire package from optimization
			]
			// Note: esbuildOptions removed for Vite 8 (Rolldown uses Oxc)
			// global: 'globalThis' is now the default in modern bundlers
		},
		
		resolve: {
			alias: {
				'$lib': '/src/lib',
				'$content': '/src/content'
			}
		},

		build: {
			// Vite 8 / Rolldown compatible chunk configuration
			// Using advancedChunks instead of deprecated manualChunks
			rollupOptions: {
				output: {
					// Rolldown's advancedChunks replaces manualChunks for better chunk control
					advancedChunks: {
						groups: [
							// CSS vendor chunks
							{ name: 'css-vendor', test: /node_modules.*(@skeletonlabs|tailwind).*\.css/ },
							{ name: 'css-external', test: /node_modules.*\.css/ },
							// Browser-only analytics
							{ name: 'vendor-analytics', test: /@fingerprintjs/ },
							// UI component library
							{ name: 'vendor-ui', test: /@skeletonlabs(?!.*\.css)/ },
							// Icon library
							{ name: 'vendor-icons', test: /@iconify/ },
							// Toast notifications
							{ name: 'vendor-toast', test: /svelte-french-toast/ },
							// OpenTelemetry (browser)
							{ name: 'vendor-otel', test: /@opentelemetry\/(api|sdk-trace-web|semantic-conventions)/ },
							// All other vendor code
							{ name: 'vendor', test: /node_modules/ }
						]
					}
				}
			},

			// Optimize chunk size warnings
			chunkSizeWarningLimit: 500, // 500KB chunks (reasonable for modern web)

			// Vite 8 uses Oxc minifier by default - no need to specify
			// minify: true uses Oxc (Rolldown's default)

			// CSS code splitting
			cssCodeSplit: true,

			// CSS configuration
			css: {
				devSourcemap: false
			}
		}
	};
});