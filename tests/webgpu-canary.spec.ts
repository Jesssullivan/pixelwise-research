import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const SOFTWARE_TOKENS = ['llvmpipe', 'lavapipe', 'softpipe', 'swiftshader'];

test('should expose a real WebGPU adapter on the GPU runner lane', async ({ page }, testInfo) => {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	let pageCrashed = false;
	let pageClosed = false;
	let uiState: {
		locationPath: string | null;
		responseOk: boolean | null;
		documentTitle: string | null;
		bodyTextSample: string | null;
		bodyChildCount: number | null;
		documentReadyState: string | null;
		hasNavigatorGpu: boolean | null;
		bodyHtmlSample: string | null;
	} = {
		locationPath: null,
		responseOk: null,
		documentTitle: null,
		bodyTextSample: null,
		bodyChildCount: null,
		documentReadyState: null,
		hasNavigatorGpu: null,
		bodyHtmlSample: null
	};
	let appCapabilities: Record<string, unknown> | null = null;
	let runtimeSummary: Record<string, unknown> | null = null;

	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			consoleErrors.push(msg.text());
		}
	});
	page.on('pageerror', (error) => {
		pageErrors.push(String(error));
	});
	page.on('crash', () => {
		pageCrashed = true;
	});
	page.on('close', () => {
		pageClosed = true;
	});

	try {
		const response = await page.goto('/');

		const shellState = await page.evaluate(() => ({
			documentTitle: document.title,
			bodyTextSample: document.body.innerText.trim().slice(0, 400),
			bodyChildCount: document.body.childElementCount,
			documentReadyState: document.readyState,
			hasNavigatorGpu: typeof navigator.gpu !== 'undefined',
			bodyHtmlSample: document.body.innerHTML.slice(0, 1200)
		}));

		expect(response?.ok()).toBe(true);
		expect(new URL(page.url()).pathname).toBe('/');

		uiState = {
			locationPath: new URL(page.url()).pathname,
			responseOk: response?.ok() ?? null,
			documentTitle: shellState.documentTitle || null,
			bodyTextSample: shellState.bodyTextSample || null,
			bodyChildCount: shellState.bodyChildCount,
			documentReadyState: shellState.documentReadyState || null,
			hasNavigatorGpu: shellState.hasNavigatorGpu,
			bodyHtmlSample: shellState.bodyHtmlSample || null
		};

		appCapabilities = await page.evaluate(async () => {
			const featureDetection = await import('/src/lib/pixelwise/featureDetection.ts');
			featureDetection.clearCapabilitiesCache();
			const caps = await featureDetection.getCapabilitiesAsync();

			return {
				webgpu: caps.webgpu,
				webgpuAdapter: caps.webgpuAdapter,
				recommendedMode: caps.recommendedMode,
				sharedArrayBuffer: caps.sharedArrayBuffer,
				wasm: caps.wasm,
				wasmSimd: caps.wasmSimd,
				importExternalTexture: caps.importExternalTexture,
				copyExternalImage: caps.copyExternalImage,
				videoFrameCallback: caps.videoFrameCallback,
				mediaStreamTrackProcessor: caps.mediaStreamTrackProcessor,
				gpuTier: caps.gpuTier
			};
		});

		runtimeSummary = await page.evaluate(async () => {
			const summary = {
				navigatorGpu: typeof navigator.gpu !== 'undefined',
				secureContext: window.isSecureContext,
				crossOriginIsolated:
					typeof globalThis.crossOriginIsolated !== 'undefined' ? globalThis.crossOriginIsolated : false,
				adapterAcquired: false,
				adapterInfoText: null as string | null,
				isFallbackAdapter: null as boolean | null,
				deviceRequestSucceeded: false,
				deviceRequestError: null as string | null
			};

			if (!navigator.gpu) {
				return summary;
			}

			let adapter =
				(await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
				(await navigator.gpu.requestAdapter());

			if (!adapter) {
				return summary;
			}

			summary.adapterAcquired = true;

			const adapterAny = adapter as unknown as Record<string, unknown>;
			summary.isFallbackAdapter =
				typeof adapterAny.isFallbackAdapter === 'boolean'
					? adapterAny.isFallbackAdapter
					: typeof adapterAny.is_fallback_adapter === 'boolean'
						? (adapterAny.is_fallback_adapter as boolean)
						: null;

			if (typeof adapterAny.requestAdapterInfo === 'function') {
				try {
					const info = await (
						adapterAny.requestAdapterInfo as unknown as (this: GPUAdapter) => Promise<Record<string, unknown>>
					).call(adapter);
					summary.adapterInfoText = ['vendor', 'architecture', 'device', 'description']
						.map((key) => info[key])
						.filter((value): value is string => typeof value === 'string' && value.length > 0)
						.join(' ');
				} catch (error) {
					summary.deviceRequestError = `requestAdapterInfo failed: ${String(error)}`;
				}
			}

			try {
				const device = await adapter.requestDevice({
					requiredFeatures: [],
					requiredLimits: {
						maxBufferSize: 256 * 1024 * 1024
					}
				});
				const testBuffer = device.createBuffer({
					size: 256,
					usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
					mappedAtCreation: true
				});
				testBuffer.unmap();
				testBuffer.destroy();
				device.destroy();
				summary.deviceRequestSucceeded = true;
			} catch (error) {
				summary.deviceRequestError = String(error);
			}

			return summary;
		});

		expect(appCapabilities.webgpu).toBe(true);
		expect(appCapabilities.recommendedMode).toBe('webgpu');
		expect(appCapabilities.webgpuAdapter).not.toBeNull();
		expect(runtimeSummary.navigatorGpu).toBe(true);
		expect(runtimeSummary.secureContext).toBe(true);
		expect(runtimeSummary.adapterAcquired).toBe(true);
		expect(runtimeSummary.isFallbackAdapter).not.toBe(true);
		expect(runtimeSummary.deviceRequestSucceeded).toBe(true);

		const adapterText = [
			String(appCapabilities.webgpuAdapter ?? ''),
			String(runtimeSummary.adapterInfoText ?? '')
		]
			.join(' ')
			.toLowerCase();

		for (const token of SOFTWARE_TOKENS) {
			expect(adapterText).not.toContain(token);
		}

		const relevantConsoleErrors = consoleErrors.filter((message) =>
			/webgpu|gpu|adapter|dawn|vulkan/i.test(message)
		);
		expect(relevantConsoleErrors).toEqual([]);
		expect(pageErrors).toEqual([]);
	} finally {
		const summary = {
			uiState,
			appCapabilities,
			runtimeSummary,
			consoleErrors,
			pageErrors,
			pageCrashed,
			pageClosed
		};

		await mkdir('test-results', { recursive: true });
		await writeFile('test-results/webgpu-summary.json', JSON.stringify(summary, null, 2));
		await testInfo.attach('webgpu-summary', {
			body: JSON.stringify(summary, null, 2),
			contentType: 'application/json'
		});
	}
});
