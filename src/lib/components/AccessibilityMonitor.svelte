<script lang="ts">
	/**
	 * Accessibility Monitor (tRPC + Svelte 5 Runes)
	 *
	 * Modernized version using tRPC observability instead of Socket.IO
	 * Features:
	 * - Real-time a11y evaluation results
	 * - Automatic batching and server sync
	 * - Element highlighting
	 * - Pause/resume functionality
	 * - Keyboard shortcuts (Alt+Shift+A)
	 *
	 * CONSENT GATING:
	 * - Basic A11y evaluation runs for all users (telemetry mode)
	 * - GPU Compositor/Advanced features require a11yExperimental consent
	 */

	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import Icon from '@iconify/svelte';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { hasA11yExperimentalConsent } from '$lib/utils/consentStorage';

	// Use import.meta.env.MODE instead of 'dev' from $app/environment
	// because dev is unreliable in containers with NODE_ENV=production
	const isDevMode = import.meta.env.MODE === 'development';

	// Consent check for experimental A11y features (GPU compositor, pixelwise remediation)
	// This runs on the client and checks the consent_record cookie
	const hasExperimentalConsent = $derived(browser ? hasA11yExperimentalConsent() : false);

	import { a11yStore } from '$lib/stores/observability/a11y.svelte';
	import { formatDistanceToNow } from 'date-fns';
	import { userdata } from '$lib/trpc/client';
	import DevLocationToggle from './admin/DevLocationToggle.svelte';
	import { A11Y_CONFIG } from '$lib/config/a11y';
import { pixelwiseStore, type WCAGLevel } from '$lib/stores/pixelwiseStore.svelte';
	import { useWebGPUCompositor } from '$lib/composables/useWebGPUCompositor.svelte';
	import { getCapabilitiesAsync, clearCapabilitiesCache, type CompositorMode } from '$lib/pixelwise/featureDetection';
	import { A11yRemediationBridge } from '$lib/pixelwise/A11yRemediationBridge';
	import { getContrastChecker, type ContrastViolation } from '$lib/services/ContrastChecker';

	// GPU Compositor instance - created EAGERLY at top level using IIFE
	// CRITICAL: useWebGPUCompositor uses onMount internally, so MUST be called during init
	// The compositor is created but NOT initialized until consent + capabilities verified
	let compositorMode: CompositorMode = $state('none');
	let compositorReady = $state(false);

	// IIFE pattern: Create compositor eagerly during component init
	// This ensures onMount is called in the correct lifecycle context
	const compositorInstance = (() => {
		if (!browser) return null;
		// Create with autoInitialize: false - we'll control initialization manually
		return useWebGPUCompositor({
			autoInitialize: false,
			wcagLevel: pixelwiseStore.wcagLevel,
			targetFps: 30
		});
	})();

	// A11y Remediation Bridge - connects violation detection to GPU compositor
	let remediationBridge: A11yRemediationBridge | null = $state(null);

	// ContrastChecker for WCAG contrast violation detection
	// Singleton instance from getContrastChecker()
	let contrastChecker = browser ? getContrastChecker() : null;

	// Contrast violations detected by ContrastChecker (separate from axe-core violations)
	let contrastViolations: ContrastViolation[] = $state([]);

	// Remediation statistics (reactive via $derived)
	const remediationStats = $derived.by(() => {
		if (!remediationBridge) return { total: 0, remediated: 0, failed: 0 };
		// Get stats from last processViolations call
		return { total: 0, remediated: 0, failed: 0 };
	});

	// Derived values for pixelwiseStore - required for Svelte 5 reactivity with class-based stores
	const pixelwiseEnabled = $derived(pixelwiseStore.enabled);
	const pixelwiseWcagLevel = $derived(pixelwiseStore.wcagLevel);
	const pixelwiseWasmReady = $derived(pixelwiseStore.wasmReady);
	const pixelwiseIsProcessing = $derived(pixelwiseStore.isProcessing);
	const pixelwiseError = $derived(pixelwiseStore.error);
	const pixelwiseStats = $derived(pixelwiseStore.stats);
	const pixelwiseTargetContrast = $derived(pixelwiseStore.targetContrast);
	const pixelwiseIsLargeText = $derived(pixelwiseStore.isLargeText);
	// Derived: Can compositor be enabled (WebGPU available)
	// Used to disable toggles when WebGPU is not available
	const canEnableCompositor = $derived(compositorMode === 'webgpu');

	/**
	 * Initialize the compositor (async capability detection + GPU init)
	 * Called when user enables pixelwise AND has consent
	 * The compositor instance was created eagerly via IIFE - this just initializes it
	 */
	async function initializeCompositor(): Promise<void> {
		if (!browser || !compositorInstance || compositorReady) return;

		// CRITICAL: Check consent before initializing
		if (!hasA11yExperimentalConsent()) {
			console.log('[AccessibilityMonitor] Compositor init blocked - no a11yExperimental consent');
			return;
		}

		// Detect capabilities asynchronously (full WebGPU device verification)
		const caps = await getCapabilitiesAsync();
		compositorMode = caps.recommendedMode;

		console.log('[AccessibilityMonitor] Detected compositor mode:', compositorMode, {
			webgpu: caps.webgpu,
			webgpuAdapter: caps.webgpuAdapter,
			wasmSimd: caps.wasmSimd,
			wasm: caps.wasm
		});

		if (compositorMode === 'webgpu') {
			// Initialize the pre-created compositor instance
			try {
				const success = await compositorInstance.initialize();
				if (success) {
					compositorReady = true;
					console.log('[AccessibilityMonitor] WebGPU compositor initialized and ready');
				} else {
					// initialize() returned false (already in progress or failed)
					console.log('[AccessibilityMonitor] Compositor initialization skipped (concurrent call)');
				}
			} catch (err) {
				console.error('[AccessibilityMonitor] Compositor initialization failed:', err);
				compositorMode = 'none';
			}
		} else {
			console.error('[AccessibilityMonitor] WebGPU required but not available');
			console.error('[AccessibilityMonitor] Requirements: WebGPU + WASM');
		}
	}

	/**
	 * Stop the compositor (but keep instance for re-initialization)
	 */
	function stopCompositor(): void {
		if (remediationBridge) {
			remediationBridge = null;
			console.log('[AccessibilityMonitor] Remediation bridge stopped');
		}
		if (compositorInstance && compositorReady) {
			compositorInstance.stop();
			compositorReady = false;
			pixelwiseStore.setWasmReady(false);
			console.log('[AccessibilityMonitor] Compositor stopped');
		}
	}

	// Effect to handle enable/disable state changes
	// Uses untrack() to prevent state_unsafe_mutation errors
	$effect(() => {
		if (!browser) return;

		if (pixelwiseEnabled && !compositorReady) {
			// Initialize compositor when enabled
			untrack(() => {
				queueMicrotask(() => {
					initializeCompositor();
				});
			});
		} else if (!pixelwiseEnabled && compositorReady) {
			stopCompositor();
		}
	});

	// Effect to auto-start/stop compositor based on ready state
	$effect(() => {
		if (!browser) return;

		const instance = compositorInstance;
		const enabled = pixelwiseEnabled;
		const ready = pixelwiseWasmReady;

		console.log('[AccessibilityMonitor] Compositor effect:', {
			hasInstance: !!instance,
			enabled,
			wasmReady: ready,
			isCompositing: instance?.isCompositing
		});

		if (!instance) return;

		if (enabled && ready) {
			// Start compositor if not already running
			if (!instance.isCompositing) {
				console.log('[AccessibilityMonitor] Starting compositor...');
				instance.start();
			}
		} else {
			// Stop compositor
			if (instance.isCompositing) {
				console.log('[AccessibilityMonitor] Stopping compositor...');
				instance.stop();
			}
		}
	});

	// Effect to scan contrast violations and process through bridge
	// This runs when compositor is active and ready
	$effect(() => {
		if (!browser || !remediationBridge || !pixelwiseEnabled || !contrastChecker) return;

		// Scan for contrast violations using ContrastChecker
		// Target level matches pixelwise store WCAG level (AAA = 7.0:1 default)
		const wcagTarget = pixelwiseWcagLevel === 'AAA' ? 'aaa' : 'aa';
		const violations = contrastChecker.scanPage({ targetLevel: wcagTarget });

		if (violations.length > 0) {
			// Update local state for UI display
			contrastViolations = violations;

			// Process through bridge to send to compositor
			const result = remediationBridge.processViolations(violations);

			if (result.success) {
				console.log(`[AccessibilityMonitor] Processed ${result.data} contrast violations`);
			} else {
				console.warn('[AccessibilityMonitor] Failed to process violations:', result.error);
			}
		} else {
			contrastViolations = [];
		}
	});

	// Component UI state
	let isOpen = $state(false);
	let isMinimized = $state(false);
	let activeTab = $state<'accessibility' | 'privacy' | 'devtools' | 'shader'>('accessibility');

	// Transparency data state
	let userData = $state<any>(null);
	let isLoadingUserData = $state(false);
	let userDataError = $state<string | null>(null);

	// Network information state (client-side detection)
	let localIp = $state<string | null>(null);
	let connectionType = $state<string | null>(null);

	// Reactive values from store using $derived
	const violations = $derived(a11yStore.violations);
	const isEvaluating = $derived(a11yStore.isEvaluating);
	const lastEvaluationTime = $derived(a11yStore.lastEvaluationTime);
	const pendingQueueSize = $derived(a11yStore.pendingQueueSize);
	const hasCritical = $derived(a11yStore.hasCritical);
	const hasSerious = $derived(a11yStore.hasSerious);
	const isConnected = $derived(a11yStore.isConnected);
	const isTesting = $derived(a11yStore.isTesting);
	const lastError = $derived(a11yStore.lastError);
	const lastSuccessfulFlush = $derived(a11yStore.lastSuccessfulFlush);
	const connectionMetrics = $derived(a11yStore.connectionTests);
	const circuitBreakerState = $derived(a11yStore.circuitBreaker);

	// Computed values
	const criticalCount = $derived(violations.filter((v) => v.impact === 'critical').length);
	const seriousCount = $derived(violations.filter((v) => v.impact === 'serious').length);
	const moderateCount = $derived(violations.filter((v) => v.impact === 'moderate').length);
	const minorCount = $derived(violations.filter((v) => v.impact === 'minor').length);

	// Phase 3: Connection metrics for debug panel
	const successRate = $derived.by(() => {
		if (!connectionMetrics.total) return 0;
		return Math.round((connectionMetrics.successful / connectionMetrics.total) * 100);
	});

	// Calculate accessibility score (100 = perfect, lower = more issues)
	const score = $derived.by(() => {
		const totalIssues = violations.length;
		if (totalIssues === 0) return 100;

		// Weight by severity
		const weightedScore = 100 - (
			criticalCount * 10 +
			seriousCount * 5 +
			moderateCount * 2 +
			minorCount * 0.5
		);

		return Math.max(0, Math.min(100, weightedScore));
	});

	// Time since last update
	const timeSinceUpdate = $derived.by(() => {
		if (!lastEvaluationTime) return null;
		return Math.floor((Date.now() - lastEvaluationTime) / 1000);
	});

	const updateTimeText = $derived.by(() => {
		if (!lastEvaluationTime) return 'never';
		try {
			return formatDistanceToNow(lastEvaluationTime, { addSuffix: true });
		} catch {
			return `${timeSinceUpdate}s ago`;
		}
	});

	const hasRecentResults = $derived.by(() => {
		return lastEvaluationTime && (Date.now() - lastEvaluationTime) < 10000;
	});

	// Convert violations to display format matching old component
	const displayResults = $derived.by(() => {
		return violations.map((v) => ({
			id: v.id,
			severity: v.impact === 'critical' || v.impact === 'serious' ? 'error' :
			         v.impact === 'moderate' ? 'warning' : 'info',
			selector: v.nodes[0]?.target?.join(', ') || 'unknown',
			message: v.description,
			impact: v.impact,
			help: v.help,
			helpUrl: v.helpUrl
		}));
	});

	// Skeleton v4 color pairing classes for severity indicators
	const severityClasses = {
		error: {
			background: 'bg-error-100-900/40',
			border: 'border-error-300-700',
			badge: 'bg-error-500 text-white',
			text: 'text-error-800-200',
			message: 'text-error-700-300',
			help: 'text-error-600-400'
		},
		warning: {
			background: 'bg-warning-100-900/40',
			border: 'border-warning-300-700',
			badge: 'bg-warning-500 text-warning-900',
			text: 'text-warning-800-200',
			message: 'text-warning-700-300',
			help: 'text-warning-600-400'
		},
		info: {
			background: 'bg-success-100-900/40',
			border: 'border-success-300-700',
			badge: 'bg-success-500 text-white',
			text: 'text-success-800-200',
			message: 'text-success-700-300',
			help: 'text-success-600-400'
		}
	} as const;

	// Stats object matching old component
	const stats = $derived.by(() => ({
		issues: violations.length,
		evaluatedElements: violations.reduce((sum, v) => sum + v.nodes.length, 0),
		totalElements: violations.reduce((sum, v) => sum + v.nodes.length, 0), // Approximation
		evaluationTimeMs: isEvaluating ? 0 : 100, // Estimate, axe doesn't expose this
		memoryUsageMB: 0, // Not tracked in new store
		bufferSize: pendingQueueSize
	}));

	/**
	 * Highlight element in DOM
	 */
	function highlightElement(selector: string) {
		if (!browser) return;

		try {
			// Remove existing highlights
			document.querySelectorAll('.accessibility-highlight').forEach((el) => {
				el.classList.remove('accessibility-highlight');
			});

			// Add highlight to target element
			const element = document.querySelector(selector);
			if (element) {
				element.classList.add('accessibility-highlight');
				element.scrollIntoView({ behavior: 'smooth', block: 'center' });

				// Remove highlight after 3 seconds
				setTimeout(() => {
					element.classList.remove('accessibility-highlight');
				}, 3000);
			}
		} catch (error) {
			console.error('[A11y Monitor] Failed to highlight element:', error);
		}
	}

	// REMOVED: startEvaluation() and stopEvaluation() functions
	// Replaced with $effect() for automatic cleanup (see below)

	/**
	 * Handle keyboard shortcuts
	 */
	function handleKeydown(e: KeyboardEvent) {
		if (e.altKey && e.shiftKey && e.key === 'A') {
			e.preventDefault();
			isOpen = !isOpen;
		}
	}

	/**
	 * Load transparency data
	 */
	async function loadTransparencyData() {
		if (!browser || userData) return; // Only load once

		isLoadingUserData = true;
		userDataError = null;

		try {
			const data = await userdata.getMyData();

			// Enhance with client-side data
			userData = {
				...data,
				device: {
					...data.device,
					viewport: `${window.innerWidth}x${window.innerHeight}`,
					screenResolution: `${screen.width}x${screen.height}`
				},
				privacy: {
					...data.privacy,
					dnt: navigator.doNotTrack === '1',
					cookiesEnabled: navigator.cookieEnabled
				}
			};
		} catch (error) {
			console.error('[A11y Monitor] Failed to load user data:', error);
			userDataError = error instanceof Error ? error.message : 'Unknown error';
		} finally {
			isLoadingUserData = false;
		}
	}

	/**
	 * Format duration helper
	 */
	function formatDuration(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}h ${remainingMinutes}m`;
	}

	/**
	 * Detect local IP address using WebRTC STUN
	 * Privacy-safe: Uses public STUN server, no data leaves client
	 */
	async function detectLocalIP() {
		if (!browser) return;

		try {
			const pc = new RTCPeerConnection({ iceServers: [] });
			pc.createDataChannel('');

			pc.onicecandidate = (ice) => {
				if (!ice || !ice.candidate || !ice.candidate.candidate) return;

				const parts = ice.candidate.candidate.split(' ');
				const ip = parts[4];

				// Only capture local IP (skip relay/reflexive candidates)
				if (ip && !ip.includes('relay') && !localIp) {
					localIp = ip;
				}

				pc.close();
			};

			await pc.createOffer().then(offer => pc.setLocalDescription(offer));
		} catch (error) {
			console.warn('[A11y Monitor] Local IP detection failed:', error);
		}
	}

	/**
	 * Detect connection type (experimental)
	 */
	function detectConnectionType() {
		if (!browser || !('connection' in navigator)) return;

		try {
			const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
			if (conn && conn.effectiveType) {
				connectionType = conn.effectiveType; // '4g', '3g', '2g', 'slow-2g'
			}
		} catch (error) {
			console.warn('[A11y Monitor] Connection type detection failed:', error);
		}
	}

	// $effect 0: Headless telemetry mode (when UI is disabled but telemetry continues)
	// This runs even when A11Y_CONFIG.uiEnabled is false
	$effect(() => {
		// Only run if UI is disabled (headless mode) and we're in the browser
		if (!browser || A11Y_CONFIG.uiEnabled) {
			return; // Skip if UI is enabled (handled by $effect 1 below)
		}

		console.info('[A11y Monitor] Starting headless telemetry mode (UI disabled, telemetry active)');

		// Initialize fingerprint for correlation
		a11yStore.initializeFingerprint();

		// Test connection on start
		a11yStore.testConnection();

		// Schedule periodic evaluations in headless mode (every 10s, less aggressive)
		const headlessEvalInterval = setInterval(() => {
			console.debug('[A11y Monitor] Running headless evaluation');
			a11yStore.evaluate();
		}, 10000); // Every 10 seconds in headless mode

		// Periodic flush to ensure data reaches server
		const flushInterval = setInterval(() => {
			a11yStore.flush();
		}, 30000); // Flush every 30 seconds

		return () => {
			console.info('[A11y Monitor] Stopping headless telemetry (cleanup)');
			clearInterval(headlessEvalInterval);
			clearInterval(flushInterval);
		};
	});

	// $effect 1: Automatic evaluation with proper cleanup (CRITICAL FIX)
	// Replaces startEvaluation/stopEvaluation pattern to prevent memory leaks
	// IMPORTANT: No immediate evaluate() call to prevent infinite loop
	$effect(() => {
		// Guard: Only run on client when monitor is open and not paused
		// Also skip if UI is disabled (handled by headless effect above)
		if (!browser || !isOpen || !A11Y_CONFIG.uiEnabled) {
			return; // Early return - no cleanup needed
		}

		console.info('[A11y Monitor] Starting automatic evaluation (every 5s)');

		// Schedule periodic evaluations ONLY (no immediate call)
		// Immediate call was causing infinite loop by updating reactive state
		const evalInterval = setInterval(() => {
			// Always run evaluation (no pause functionality)
			console.debug('[A11y Monitor] Running scheduled evaluation');
			a11yStore.evaluate();
		}, 5000); // Every 5 seconds

		// CLEANUP: Automatically runs when isOpen or browser changes
		return () => {
			console.info('[A11y Monitor] Stopping automatic evaluation (cleanup)');
			clearInterval(evalInterval);
		};
	});

	// $effect 2: Circuit breaker recovery testing (CRITICAL FIX)
	// Moved from store initialization to component for proper cleanup
	$effect(() => {
		if (!browser) return;

		console.info('[A11y Monitor] Starting circuit breaker recovery monitor');

		// Check circuit breaker state every 5 minutes
		const circuitBreakerInterval = setInterval(() => {
			const breakerState = a11yStore.circuitBreaker;
			if (breakerState.state === 'OPEN') {
				console.log('[A11y Monitor] Testing connection during circuit breaker timeout');
				a11yStore.testConnection();
			}
		}, 5 * 60 * 1000); // 5 minutes

		// CLEANUP: Runs when component unmounts
		return () => {
			console.info('[A11y Monitor] Stopping circuit breaker monitor (cleanup)');
			clearInterval(circuitBreakerInterval);
		};
	});

	// Load transparency data when privacy tab opens
	$effect(() => {
		if (isOpen && activeTab === 'privacy') {
			loadTransparencyData();
		}
	});

	// $effect 3: Periodic health checks (60s interval)
	// Note: Immediate test removed to prevent infinite loop (testConnection updates reactive state)
	// Store initialization already handles immediate connection test (a11y.svelte.ts:502)
	$effect(() => {
		if (!browser) return;

		console.info('[A11y Monitor] Starting periodic health checks (every 60s)');

		// Schedule periodic tests (no immediate call to avoid infinite loop)
		const healthCheckInterval = setInterval(() => {
			console.log('[A11y Monitor] Running periodic health check');
			a11yStore.testConnection();
		}, 60000); // 60 seconds

		// CLEANUP: Runs when component unmounts
		return () => {
			console.info('[A11y Monitor] Stopping health checks (cleanup)');
			clearInterval(healthCheckInterval);
		};
	});

	onMount(() => {
		if (!browser) return;

		// Add keyboard listener
		window.addEventListener('keydown', handleKeydown);

		// Detect local IP and connection type on mount
		detectLocalIP();
		detectConnectionType();

		// Initialize compositor on mount if already enabled (initial page load with saved settings)
		// Compositor instance was created eagerly via IIFE - this initializes it
		if (pixelwiseStore.enabled && !compositorReady) {
			console.log('[AccessibilityMonitor] Initializing compositor on mount (enabled from saved settings)');
			initializeCompositor();
		}

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			// Stop compositor on unmount (instance will be garbage collected)
			stopCompositor();
		};
	});
</script>

<!-- A11y UI Toggle: Only render UI when PUBLIC_A11Y_UI != 'false' -->
<!-- Telemetry continues running in headless mode via $effect 0 -->
{#if A11Y_CONFIG.uiEnabled}
<!-- Floating button with status indicator -->
<!-- data-accessibility-monitor allows DirectColorSampler to skip this overlay -->
<div class="fixed bottom-4 right-4 z-[10001]" data-accessibility-monitor>
	<button
		onclick={() => isOpen = !isOpen}
		class="btn preset-filled-success-500 text-white shadow-xl relative px-4 py-2 flex items-center gap-2"
		aria-label="Toggle accessibility monitor - {violations.length} issues"
	>
		<!-- Cat with heart eyes emoji -->
		<span class="text-2xl">😻</span>

		<!-- Issue count inline (if critical issues exist) -->
		{#if criticalCount > 0}
			<span class="font-bold text-sm text-error-600-400">
				{criticalCount > 9 ? '9+' : criticalCount}
			</span>
		{/if}

		<!-- Status indicator dot - reflects actual trace streaming status -->
		<div class="absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-white
		            {isConnected ? 'bg-success-500 animate-pulse' : 'bg-error-500'}"
		     aria-hidden="true"
		     title="{isConnected ? 'Trace streaming active' : 'Trace streaming disconnected'}"></div>
	</button>
</div>

<!-- Monitor panel - NOT using .card class to avoid high-contrast theme !important overrides -->
{#if isOpen}
	<div
		class="rounded-xl border-2 border-surface-300-600 bg-surface-50-900 text-surface-900-50 fixed z-[10001] shadow-2xl flex flex-col
		       bottom-2 right-2 left-2 sm:bottom-20 sm:right-4 sm:left-auto
		       sm:w-96 max-w-md
		       max-h-[calc(100vh-6rem)] sm:max-h-[70vh]
		       overflow-hidden"
		role="dialog"
		aria-label="Accessibility monitor"
	>
		<!-- Header - explicit styles instead of card-header -->
		<header class="p-4 border-b border-surface-200-700 flex items-center justify-between flex-shrink-0 bg-surface-100-800">
			<div class="flex-1 min-w-0">
				<h3 class="font-semibold flex items-center gap-2 text-sm sm:text-base text-surface-900-50">
					<!-- Solid shield icon -->
					<svg class="w-4 h-4 sm:w-5 sm:h-5 text-primary-600-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/>
					</svg>
					<span class="hidden sm:inline">Accessibility Monitor</span>
					<span class="sm:hidden">A11y</span>
					<span class="badge preset-tonal-primary text-xs text-primary-700-300">
						tRPC
					</span>
				</h3>
				<div class="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm mt-1 flex-wrap">
					<span class="badge {score >= 90 ? 'preset-tonal-success text-success-700-300' : score >= 70 ? 'preset-tonal-warning text-warning-700-300' : 'preset-tonal-error text-error-700-300'}">
						Score: {Math.round(score)}%
					</span>
					<span class="text-surface-600-300">
						{stats.issues} issues
					</span>
					{#if criticalCount > 0}
						<span class="badge preset-filled-error-500 text-white">
							{criticalCount} critical
						</span>
					{/if}
					{#if seriousCount > 0}
						<span class="badge preset-filled-warning-500 text-warning-900">
							{seriousCount} serious
						</span>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-1">
				<button
					onclick={() => isMinimized = !isMinimized}
					class="btn btn-sm btn-icon bg-surface-200-700 border border-surface-300-600 text-surface-700-200 hover:border-surface-400-500"
					aria-label={isMinimized ? 'Expand' : 'Minimize'}
				>
					<Icon icon={isMinimized ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="w-4 h-4" />
				</button>
				<button
					onclick={() => isOpen = false}
					class="btn btn-sm btn-icon bg-surface-200-700 border border-surface-300-600 text-surface-700-200 hover:border-surface-400-500"
					aria-label="Close"
				>
					<Icon icon="mdi:close" class="w-4 h-4" />
				</button>
			</div>
		</header>

		<!-- Content -->
		{#if !isMinimized}
			<div class="flex-1 overflow-hidden flex flex-col min-h-0">
				<!-- Stats -->
				<div class="bg-surface-200-700 p-4 flex-shrink-0">
					<div class="grid grid-cols-2 gap-4 text-sm mb-3">
						<div>
							<div class="text-surface-600-300">Elements</div>
							<div class="font-medium text-surface-900-50">{stats.evaluatedElements}</div>
						</div>
						<div>
							<div class="text-surface-600-300">Status</div>
							<div class="font-medium text-xs">
								{#if isEvaluating}
									<span class="text-primary-600-400">Evaluating...</span>
								{:else}
									<span class="text-success-600-400">Monitoring</span>
								{/if}
							</div>
						</div>
						<div>
							<div class="text-surface-600-300">Critical</div>
							<div class="font-medium text-error-600-400">{criticalCount}</div>
						</div>
						<div>
							<div class="text-surface-600-300">Queue</div>
							<div class="font-medium text-xs">
								<span class="{pendingQueueSize > 8 ? 'text-warning-600-400' : 'text-surface-700-300'}">
									{pendingQueueSize}/10
								</span>
							</div>
						</div>
					</div>
					<div class="text-xs text-surface-700-300 flex items-center gap-2">
						<div class="flex items-center gap-1">
							<!-- Connection status indicator dot - Phase 2: Shows testing state -->
							<div class="w-2 h-2 rounded-full
								{isTesting ? 'bg-warning-500 animate-pulse' :
								 isConnected ? 'bg-success-500' : 'bg-error-500'}
								{isConnected && hasRecentResults && !isTesting ? 'animate-pulse' : ''}">
							</div>
							<span>tRPC:
								{#if isTesting}
									<span class="text-warning-600-400 font-medium">Testing...</span>
								{:else if isConnected}
									<span class="text-success-600-400 font-medium">Connected</span>
								{:else if lastError}
									<span class="text-error-600-400 font-medium" title="{lastError}">Error</span>
								{:else}
									<span class="text-warning-600-400 font-medium">Disconnected</span>
								{/if}
							</span>
						</div>
						{#if lastEvaluationTime}
							<span>• Updated {updateTimeText}</span>
						{/if}
						{#if timeSinceUpdate && timeSinceUpdate > 60}
							<span class="text-warning-600-400">• Stale</span>
						{/if}
					</div>
				</div>

				<!-- Tab Navigation - Compact for 4 tabs -->
				<div class="flex gap-1 px-2 pt-2 border-t border-surface-300-600 flex-shrink-0 overflow-x-auto">
					<button
						onclick={() => activeTab = 'accessibility'}
						class="btn btn-sm px-2 min-w-0 {activeTab === 'accessibility' ? 'bg-primary-500 text-white border border-primary-600' : 'bg-surface-200-700 text-surface-700-200 border border-surface-300-600 hover:border-surface-400-500'} flex-1"
					>
						<Icon icon="lucide:shield" width={12} />
						<span class="text-xs">A11y</span>
					</button>
					<button
						onclick={() => { activeTab = 'privacy'; }}
						class="btn btn-sm px-2 min-w-0 {activeTab === 'privacy' ? 'bg-primary-500 text-white border border-primary-600' : 'bg-surface-200-700 text-surface-700-200 border border-surface-300-600 hover:border-surface-400-500'} flex-1"
					>
						<Icon icon="lucide:database" width={12} />
						<span class="text-xs">Data</span>
					</button>
					<button
						onclick={() => activeTab = 'shader'}
						class="btn btn-sm px-2 min-w-0 {activeTab === 'shader' ? 'bg-primary-500 text-white border border-primary-600' : 'bg-surface-200-700 text-surface-700-200 border border-surface-300-600 hover:border-surface-400-500'} flex-1"
					>
						<Icon icon="lucide:sparkles" width={12} />
						<span class="text-xs">Shader</span>
					</button>
					{#if isDevMode}
						<button
							onclick={() => activeTab = 'devtools'}
							class="btn btn-sm px-2 min-w-0 {activeTab === 'devtools' ? 'bg-primary-500 text-white border border-primary-600' : 'bg-surface-200-700 text-surface-700-200 border border-surface-300-600 hover:border-surface-400-500'} flex-1"
						>
							<Icon icon="lucide:wrench" width={12} />
							<span class="text-xs">Dev</span>
						</button>
					{/if}
				</div>

				<!-- Tab Content -->
				<div class="p-4 flex-1 overflow-y-auto text-surface-900-50">
					{#if activeTab === 'accessibility' && displayResults.length === 0}
						<div class="text-center text-surface-600-300 py-8">
							<div class="mb-2">
								{#if isEvaluating}
									🔍 Scanning for issues...
								{:else if lastEvaluationTime}
									✅ No issues found!
								{:else}
									🚀 Starting evaluation...
								{/if}
							</div>
							{#if stats.evaluatedElements > 0}
								<div class="text-xs text-success-700-300">
									✅ {stats.evaluatedElements} elements analyzed
								</div>
							{/if}
						</div>
					{:else if activeTab === 'accessibility'}
						<!-- Scrollable results display -->
						<div class="flex-1 max-h-48 sm:max-h-64 overflow-y-auto rounded p-3 text-xs font-mono bg-surface-100-800 text-surface-900-50" tabindex="0" role="region" aria-label="Accessibility violations list">
							<div class="text-sm mb-2 text-primary-600-400">
								Last updated: {updateTimeText}
							</div>
							{#each displayResults.slice(0, 10) as result}
								{@const classes = severityClasses[result.severity]}
								<div
									class="mb-2 p-2 rounded cursor-pointer transition-colors {classes.background} border {classes.border}"
									onclick={() => highlightElement(result.selector)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											highlightElement(result.selector);
										}
									}}
									role="button"
									tabindex="0"
								>
									<div class="font-semibold flex items-center gap-1">
										<span class="badge text-xs {classes.badge}">
											{result.impact}
										</span>
										<span class="text-xs truncate {classes.text}">{result.selector}</span>
									</div>
									<div class="text-xs mt-1 {classes.message}">{result.message}</div>
									{#if result.help}
										<div class="text-xs mt-1 {classes.help}">
											💡 {result.help}
										</div>
									{/if}
								</div>
							{/each}
							{#if displayResults.length > 10}
								<div class="text-center text-surface-700-300 mt-2">
									... and {displayResults.length - 10} more results
								</div>
							{/if}
						</div>
					{:else if activeTab === 'shader'}
						<!-- GPU Compositor Tab - WebGL WCAG Contrast Enhancement -->
						<!-- CONSENT GATED: Only show full controls with a11yExperimental consent -->
						<div class="space-y-4">
							<h4 class="text-xs font-semibold uppercase tracking-wider text-surface-600-300 flex items-center gap-1">
								<Icon icon="lucide:sparkles" width={14} />
								GPU Compositor
							</h4>

							{#if !hasExperimentalConsent}
								<!-- Consent Required Notice -->
								<div class="bg-warning-100-900 border border-warning-300-700 p-4 rounded-xl">
									<p class="text-sm font-medium text-warning-800-200 mb-2 flex items-center gap-2">
										<Icon icon="lucide:lock" width={16} />
										Experimental Features Disabled
									</p>
									<p class="text-xs text-warning-700-300 mb-3">
										GPU-accelerated accessibility features require explicit consent. These features include:
									</p>
									<ul class="text-xs text-warning-700-300 list-disc list-inside mb-3 space-y-1">
										<li>Real-time WCAG contrast adjustment</li>
										<li>Per-pixel text remediation via Futhark WASM</li>
										<li>WebGPU GPU compositing</li>
									</ul>
									<p class="text-xs text-warning-600-400">
										Enable "Experimental accessibility features" in your privacy settings to use these features.
									</p>
								</div>
							{:else}
							<div class="bg-tertiary-100-900 border border-tertiary-300-700 p-3 rounded-xl mb-4">
								<p class="text-xs flex items-center gap-1 text-tertiary-800-200">
									<Icon icon="lucide:info" width={12} />
									<strong>WebGPU:</strong> GPU-accelerated WCAG contrast adjustment via compute shaders.
								</p>
							</div>

							<!-- WebGPU Diagnostics Panel -->
							<div class="bg-surface-100-800 border border-surface-300-600 p-3 rounded-xl mb-4">
								<div class="flex gap-2 mb-3">
									<button
										type="button"
										onclick={async () => {
											const caps = await getCapabilitiesAsync();
											console.group('[WebGPU Diagnostics]');
											console.log('Browser:', navigator.userAgent);
											console.log('navigator.gpu:', navigator.gpu !== undefined);
											console.log('Secure Context:', window.isSecureContext);
											console.log('Cross-Origin Isolated:', crossOriginIsolated);
											console.log('Capabilities:', caps);
											console.groupEnd();
											alert(JSON.stringify({
												navigatorGpu: navigator.gpu !== undefined,
												secureContext: window.isSecureContext,
												crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
												webgpu: caps.webgpu,
												webgpuAdapter: caps.webgpuAdapter,
												wasmSimd: caps.wasmSimd,
												sharedArrayBuffer: caps.sharedArrayBuffer,
												recommendedMode: caps.recommendedMode,
												browser: navigator.userAgent.slice(0, 50) + '...'
											}, null, 2));
										}}
										class="btn btn-sm preset-tonal-primary flex-1"
									>
										<Icon icon="lucide:bug" width={14} />
										<span>Run Diagnostics</span>
									</button>

									<button
										type="button"
										onclick={async () => {
											console.log('[AccessibilityMonitor] Clearing WebGPU cache and re-detecting...');
											clearCapabilitiesCache();

											// Always run fresh detection and update UI
											const caps = await getCapabilitiesAsync();
											compositorMode = caps.recommendedMode;
											console.log('[AccessibilityMonitor] Re-detection complete. Mode:', compositorMode, {
												webgpu: caps.webgpu,
												wasmSimd: caps.wasmSimd,
												wasm: caps.wasm
											});

											// Re-initialize compositor if enabled and WebGPU available
											if (pixelwiseStore.enabled && compositorMode === 'webgpu' && !compositorReady) {
												await initializeCompositor();
											}
										}}
										class="btn btn-sm preset-tonal-warning flex-1"
									>
										<Icon icon="lucide:refresh-cw" width={14} />
										<span>Force Re-detect</span>
									</button>
								</div>

								<div class="space-y-2 text-xs">
									<div class="flex items-center justify-between">
										<span class="text-surface-600-300">navigator.gpu</span>
										<span class="font-mono {browser && navigator.gpu ? 'text-success-600-400' : 'text-error-600-400'}">
											{browser ? (navigator.gpu ? '✓ Available' : '✗ Undefined') : 'SSR'}
										</span>
									</div>
									<div class="flex items-center justify-between">
										<span class="text-surface-600-300">Secure Context</span>
										<span class="font-mono {browser && window.isSecureContext ? 'text-success-600-400' : 'text-error-600-400'}">
											{browser ? (window.isSecureContext ? '✓ Yes' : '✗ No') : 'SSR'}
										</span>
									</div>
									<div class="flex items-center justify-between">
										<span class="text-surface-600-300">Cross-Origin Isolated</span>
										<span class="font-mono {browser && crossOriginIsolated ? 'text-success-600-400' : 'text-warning-600-400'}">
											{browser ? (crossOriginIsolated ? '✓ Yes' : '⚠ No (optional)') : 'SSR'}
										</span>
									</div>
									<div class="flex items-center justify-between">
										<span class="text-surface-600-300">Compositor Mode</span>
										<span class="font-mono {compositorMode === 'webgpu' ? 'text-success-600-400' : compositorMode === 'canvas2d' ? 'text-warning-600-400' : 'text-error-600-400'}">
											{compositorMode}
										</span>
									</div>
									<div class="flex items-center justify-between">
										<span class="text-surface-600-300">Consent</span>
										<span class="font-mono {hasExperimentalConsent ? 'text-success-600-400' : 'text-warning-600-400'}">
											{hasExperimentalConsent ? '✓ Granted' : '⚠ Required'}
										</span>
									</div>
								</div>

								{#if compositorMode === 'canvas2d' || compositorMode === 'none'}
									<div class="mt-3 p-2 bg-error-100-900/40 border border-error-300-700 rounded text-xs">
										<p class="text-error-800-200 font-medium mb-1 flex items-center gap-1">
											<Icon icon="lucide:x-circle" width={12} />
											WebGPU Required
										</p>
										<p class="text-error-700-300 text-[10px]">
											The WCAG compositor requires WebGPU support. Canvas2D fallback has been removed.
											{#if browser && !navigator.gpu}
												<br/><strong>Issue:</strong> navigator.gpu not available
												<br/><strong>Solution:</strong> Use Chrome 113+, Edge 113+, or Firefox 129+ with dom.webgpu.enabled=true
											{:else}
												<br/><strong>Issue:</strong> WebGPU adapter request failed
												<br/><strong>Check console logs</strong> for detailed WebGPU detection errors
											{/if}
										</p>
									</div>
								{/if}
							</div>

							<div class="space-y-3">
								<!-- Enable/Disable Toggle - Skeleton Switch (composed pattern with HiddenInput) -->
								<!-- Disabled when WebGPU is not available -->
								<Switch
									checked={pixelwiseEnabled}
									disabled={!canEnableCompositor}
									onCheckedChange={(details) => {
										if (!canEnableCompositor) return;
										console.log('[AccessibilityMonitor] Switch toggled:', details.checked);
										pixelwiseStore.setEnabled(details.checked);
									}}
									class="flex items-center justify-between group {canEnableCompositor ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}"
								>
									<Switch.HiddenInput />
									<div class="flex flex-col">
										<Switch.Label class="text-sm text-surface-700-200 {canEnableCompositor ? 'group-hover:text-surface-900-50' : ''} transition-colors">
											Enable Compositor
										</Switch.Label>
										{#if !canEnableCompositor}
											<span class="text-[10px] text-warning-600-400">
												WebGPU required but not available
											</span>
										{/if}
									</div>
									<Switch.Control class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors bg-surface-300-600 data-[state=checked]:bg-primary-500 {!canEnableCompositor ? 'opacity-50' : ''}">
										<Switch.Thumb class="inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform translate-x-1 data-[state=checked]:translate-x-6" />
									</Switch.Control>
								</Switch>

								{#if pixelwiseEnabled}
									<!-- WCAG Level Selector -->
									<div class="flex items-center justify-between">
										<span class="text-sm text-surface-700-200">WCAG Level</span>
										<div class="flex gap-1">
											<button
												type="button"
												class="btn btn-sm {pixelwiseWcagLevel === 'AA' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
												onclick={() => {
													pixelwiseStore.setWCAGLevel('AA');
													compositorInstance?.setWCAGLevel('AA');
												}}
											>
												AA (4.5:1)
											</button>
											<button
												type="button"
												class="btn btn-sm {pixelwiseWcagLevel === 'AAA' ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
												onclick={() => {
													pixelwiseStore.setWCAGLevel('AAA');
													compositorInstance?.setWCAGLevel('AAA');
												}}
											>
												AAA (7:1)
											</button>
										</div>
									</div>

									<!-- Compositor Mode Display -->
									<div class="flex items-center justify-between">
										<span class="text-sm text-surface-700-200">Rendering Mode</span>
										<span class="badge {compositorMode === 'webgpu' ? 'preset-filled-success-500' : compositorMode === 'canvas2d' ? 'preset-filled-warning-500' : 'preset-tonal-surface'}">
											{compositorMode === 'webgpu' ? 'WebGPU Compute' : compositorMode === 'canvas2d' ? 'Canvas 2D' : 'None'}
										</span>
									</div>

									<!-- Status Indicator -->
									<div class="mt-4 p-3 bg-surface-100-800 rounded-lg">
										<div class="text-xs font-medium text-surface-700-200 mb-2">Status</div>
										<div class="flex items-center gap-2">
											<div class="w-2 h-2 rounded-full {compositorInstance?.isCompositing ? 'bg-success-500 animate-pulse' : pixelwiseIsProcessing ? 'bg-warning-500 animate-pulse' : pixelwiseWasmReady ? 'bg-success-500' : 'bg-surface-400'}"></div>
											<span class="text-sm">
												{#if compositorInstance?.isCompositing}
													<span class="text-success-600-400">Compositing @ 30fps</span>
												{:else if pixelwiseIsProcessing}
													<span class="text-warning-600-400">Initializing...</span>
												{:else if pixelwiseError}
													<span class="text-error-500">{pixelwiseError.message}</span>
												{:else if pixelwiseWasmReady}
													<span class="text-success-600-400">Ready</span>
												{:else}
													<span class="text-surface-600-300">Enable to initialize...</span>
												{/if}
											</span>
										</div>

										{#if compositorInstance && pixelwiseWasmReady}
											<!-- Compositor Statistics -->
											<div class="mt-3 grid grid-cols-2 gap-3 text-xs">
												<!-- Mode -->
												<div class="flex items-start gap-2">
													<Icon icon="lucide:cpu" class="size-3.5 text-primary-600-400 mt-0.5 flex-shrink-0" />
													<div class="flex-1 min-w-0">
														<div class="text-surface-500-400">Renderer</div>
														<div class="font-medium text-surface-900-50">{compositorMode.toUpperCase()}</div>
													</div>
												</div>

												<!-- Target FPS -->
												<div class="flex items-start gap-2">
													<Icon icon="lucide:gauge" class="size-3.5 text-warning-600-400 mt-0.5 flex-shrink-0" />
													<div class="flex-1 min-w-0">
														<div class="text-surface-500-400">Target FPS</div>
														<div class="font-medium text-surface-900-50">30</div>
													</div>
												</div>

												<!-- Contrast Target -->
												<div class="flex items-start gap-2">
													<Icon icon="lucide:contrast" class="size-3.5 text-tertiary-600-400 mt-0.5 flex-shrink-0" />
													<div class="flex-1 min-w-0">
														<div class="text-surface-500-400">Contrast</div>
														<div class="font-medium text-surface-900-50">{pixelwiseTargetContrast}:1</div>
													</div>
												</div>

												<!-- Active Status -->
												<div class="flex items-start gap-2">
													<Icon icon="lucide:activity" class="size-3.5 text-success-600-400 mt-0.5 flex-shrink-0" />
													<div class="flex-1 min-w-0">
														<div class="text-surface-500-400">State</div>
														<div class="font-medium {compositorInstance?.isCompositing ? 'text-success-600-400' : 'text-surface-600-300'}">
															{compositorInstance?.isCompositing ? 'Active' : 'Idle'}
														</div>
													</div>
												</div>
											</div>

											<!-- How it works -->
											<div class="mt-3 p-2 bg-primary-100-900/40 border border-primary-300-700 rounded text-xs">
												<p class="text-primary-700-300 flex items-start gap-1.5">
													<Icon icon="lucide:info" class="size-3 mt-0.5 flex-shrink-0" />
													<span>GPU compositor overlays adjusted text colors without modifying DOM. Original text remains accessible.</span>
												</p>
											</div>
										{/if}
									</div>

									<!-- Technical Details -->
									{#if pixelwiseWasmReady}
										<div class="bg-tertiary-100-900 border border-tertiary-300-700 p-3 rounded-xl mt-3">
											<p class="text-xs flex items-center gap-1 text-tertiary-800-200">
												<Icon icon="lucide:zap" width={12} />
												<strong>GPU pipeline:</strong> GPU buffer → mapAsync() → Futhark WASM compute → unmap() → render.
											</p>
										</div>
									{/if}

									<!-- Stop/Start Controls -->
									{#if compositorInstance}
										<div class="flex gap-2 mt-3">
											{#if compositorInstance.isCompositing}
												<button
													type="button"
													class="btn btn-sm flex-1 preset-tonal-warning"
													onclick={() => compositorInstance?.stop()}
												>
													<Icon icon="lucide:pause" width={14} />
													<span>Pause</span>
												</button>
											{:else}
												<button
													type="button"
													class="btn btn-sm flex-1 preset-tonal-success"
													onclick={() => compositorInstance?.start()}
												>
													<Icon icon="lucide:play" width={14} />
													<span>Start</span>
												</button>
											{/if}
											<button
												type="button"
												class="btn btn-sm flex-1 preset-tonal-primary"
												onclick={() => compositorInstance?.composite()}
											>
												<Icon icon="lucide:refresh-cw" width={14} />
												<span>Single Pass</span>
											</button>
										</div>
									{/if}

									<!-- Technical Details -->
									<div class="text-xs text-surface-500-400 space-y-1 mt-3">
										<div>Target: {pixelwiseTargetContrast}:1 contrast ratio</div>
										<div>Large text threshold: {pixelwiseIsLargeText ? 'Yes (3:1)' : 'No (4.5:1)'}</div>
									</div>
								{/if}
							</div>
							{/if}
						</div>
					{:else if activeTab === 'privacy'}
						<!-- Privacy Tab Content -->
						<div class="space-y-3">
							<h4 class="text-xs font-semibold uppercase tracking-wider text-surface-600-300 flex items-center gap-1">
								<Icon icon="lucide:shield-check" width={14} />
								Your Data & Privacy
							</h4>

							{#if isLoadingUserData}
								<div class="flex items-center justify-center py-4">
									<Icon icon="lucide:loader-2" width={20} class="animate-spin text-primary-600-400" />
									<span class="ml-2 text-sm text-surface-600-300">Loading...</span>
								</div>
							{:else if userDataError}
								<div class="text-xs text-error-600-400 p-2 bg-error-50-900/20 rounded">
									Failed to load transparency data: {userDataError}
								</div>
							{:else if userData}
								<div class="space-y-3 text-sm">
									<!-- Location -->
									<div class="mb-2">
										<div class="flex items-center gap-1.5 mb-1">
											<Icon icon="lucide:map-pin" width={14} class="text-primary-600-400" />
											<span class="text-xs font-medium text-surface-700-200">Location</span>
										</div>
										<p class="text-xs text-surface-700-200 ml-5">
											{#if userData.location.isPrivateIp}
												<span class="text-surface-600-300">Localhost/Private Network</span>
											{:else if userData.location.city === 'Unknown' && userData.location.country === 'Unknown'}
												<span class="text-surface-600-300">Location unavailable</span>
											{:else if userData.location.city === 'Unknown'}
												{userData.location.country}
											{:else}
												{userData.location.city}, {userData.location.country}
											{/if}
											{#if userData.vpn.detected}
												<span class="badge preset-tonal-warning ml-1 text-xs text-warning-700-300">
													VPN{#if userData.vpn.provider}: {userData.vpn.provider}{/if}
												</span>
											{/if}
										</p>
										{#if userData.location.timezone && !userData.location.isPrivateIp}
											<p class="text-xs text-surface-600-300 ml-5 mt-0.5">
												Timezone: {userData.location.timezone}
											</p>
										{/if}
									</div>

									<!-- Network Information (NEW) -->
									<div class="mb-2">
										<div class="flex items-center gap-1.5 mb-1">
											<Icon icon="lucide:wifi" width={14} class="text-tertiary-600-400" />
											<span class="text-xs font-medium text-surface-700-200">Network</span>
										</div>
										<div class="space-y-1 ml-5">
											{#if userData.privacy?.ipHashed}
												<p class="text-xs text-surface-700-200">
													<span class="text-surface-600-300">IP Hash:</span> <code class="text-xs font-mono">{userData.privacy.ipHashed.slice(0,12)}...</code>
												</p>
											{/if}
											{#if localIp}
												<p class="text-xs text-surface-700-200">
													<span class="text-surface-600-300">Local IP:</span> <code class="text-xs font-mono">{localIp}</code>
												</p>
											{/if}
											{#if connectionType}
												<p class="text-xs text-surface-700-200">
													<span class="text-surface-600-300">Connection:</span> {connectionType.toUpperCase()}
												</p>
											{/if}
											{#if !userData.location.isPrivateIp && userData.location.city !== 'Unknown'}
												<p class="text-xs text-surface-700-200">
													<span class="text-surface-600-300">Nearest City:</span> {userData.location.city}
												</p>
											{/if}
										</div>
									</div>

									<!-- Browser -->
									<div class="mb-2">
										<div class="flex items-center gap-1.5 mb-1">
											<Icon icon="lucide:globe" width={14} class="text-secondary-600-400" />
											<span class="text-xs font-medium text-surface-700-200">Browser</span>
										</div>
										<p class="text-xs text-surface-700-200 ml-5">
											{userData.browser.description}
										</p>
									</div>

									<!-- Session -->
									<div class="mb-2">
										<div class="flex items-center gap-1.5 mb-1">
											<Icon icon="lucide:clock" width={14} class="text-tertiary-600-400" />
											<span class="text-xs font-medium text-surface-700-200">Session</span>
										</div>
										<p class="text-xs text-surface-700-200 ml-5">
											{formatDuration(userData.session.duration)} • {userData.session.pageViews} pages
										</p>
									</div>

									<!-- Legal Links -->
									<div class="grid grid-cols-2 gap-2 mb-2">
										<a href="/legal/privacy" class="btn btn-sm bg-primary-100-900 border border-primary-300-700 text-primary-700-300 text-xs flex items-center justify-center gap-1 py-1.5 hover:border-primary-500">
											<Icon icon="lucide:shield" width={12} />
											Privacy
										</a>
										<a href="/legal/terms" class="btn btn-sm bg-primary-100-900 border border-primary-300-700 text-primary-700-300 text-xs flex items-center justify-center gap-1 py-1.5 hover:border-primary-500">
											<Icon icon="lucide:file-text" width={12} />
											Terms
										</a>
										<a href="/legal/cookies" class="btn btn-sm bg-primary-100-900 border border-primary-300-700 text-primary-700-300 text-xs flex items-center justify-center gap-1 py-1.5 hover:border-primary-500">
											<Icon icon="lucide:cookie" width={12} />
											Cookies
										</a>
										<a href="/legal/data-collection" class="btn btn-sm bg-primary-100-900 border border-primary-300-700 text-primary-700-300 text-xs flex items-center justify-center gap-1 py-1.5 hover:border-primary-500">
											<Icon icon="lucide:database" width={12} />
											Data
										</a>
									</div>

									<!-- Privacy Note (Updated with IP retention policy) -->
									<div class="bg-success-50-900/20 p-3 rounded text-xs border border-success-300-700 space-y-2">
										<p class="text-surface-700-200 font-medium flex items-center gap-1">
											<Icon icon="lucide:shield-check" width={14} class="inline" />
											Your Privacy Protection
										</p>
										<ul class="text-surface-600-300 space-y-1 text-xs">
											<li>• IP stored in 3 forms: raw (7d), encrypted (90d), hashed (permanent)</li>
											<li>• City-level location only - no GPS tracking</li>
											<li>• Local IP never leaves your device</li>
											<li>• <a href="/privacy" class="underline text-surface-700-200 hover:text-primary-600-400">Full privacy policy →</a></li>
										</ul>
									</div>
								</div>
							{/if}
						</div>
					{:else if activeTab === 'devtools'}
						<!-- Dev Tools Tab Content -->
						<div class="space-y-4">
							<div class="flex items-center gap-2 mb-3">
								<Icon icon="lucide:flask-conical" width={16} class="text-primary-600-400" />
								<h4 class="text-sm font-semibold">
									Development Tools
								</h4>
							</div>

							<div class="bg-primary-100-900 border border-primary-300-700 p-3 rounded-xl mb-4">
								<p class="text-xs flex items-center gap-1 text-primary-800-200">
									<Icon icon="lucide:info" width={12} />
									<strong>Testing & QA:</strong> Tools for populating test data and validating features.
								</p>
							</div>

							<!-- Dev Location Toggle -->
							<DevLocationToggle />
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
{/if}

<style>
	:global(.accessibility-highlight) {
		outline: 3px solid rgb(var(--color-error-500)) !important;
		outline-offset: 2px !important;
		animation: pulse-highlight 2s ease-out;
		position: relative;
		z-index: 9997 !important;
	}

	@keyframes pulse-highlight {
		0% {
			box-shadow: 0 0 0 0 rgba(var(--color-error-500), 0.7);
		}
		70% {
			box-shadow: 0 0 0 10px rgba(var(--color-error-500), 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(var(--color-error-500), 0);
		}
	}
</style>
