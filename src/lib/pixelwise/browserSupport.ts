/**
 * Browser Support Detection for WebGPU
 *
 * Provides detailed browser compatibility checking and recommendations
 * for WebGPU and related features required for the Pixelwise compositor.
 */

import { browser } from '$app/environment';

export interface BrowserInfo {
	name: string;
	version: string;
	fullVersion: string;
	os: string;
	isMobile: boolean;
}

export interface WebGPUSupport {
	supported: boolean;
	browserInfo: BrowserInfo;
	minimumVersion: string | null;
	recommendation: string;
	detailedIssue: string | null;
}

/**
 * Parse user agent to extract browser name and version
 */
export function parseBrowserInfo(): BrowserInfo {
	if (!browser) {
		return {
			name: 'Unknown',
			version: '0',
			fullVersion: '0.0.0',
			os: 'Unknown',
			isMobile: false
		};
	}

	const ua = navigator.userAgent;
	let browserName = 'Unknown';
	let version = '0';
	let fullVersion = '0.0.0';
	let os = 'Unknown';
	const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

	// Detect OS
	if (/Windows NT/.test(ua)) os = 'Windows';
	else if (/Mac OS X/.test(ua)) os = 'macOS';
	else if (/Linux/.test(ua)) os = 'Linux';
	else if (/Android/.test(ua)) os = 'Android';
	else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';

	// Detect browser and version
	// Order matters: Check for Edge before Chrome, check for Chrome before Safari
	if (/Edg\//.test(ua)) {
		browserName = 'Edge';
		const match = ua.match(/Edg\/(\d+)\.(\d+)\.(\d+)/);
		if (match) {
			version = match[1];
			fullVersion = `${match[1]}.${match[2]}.${match[3]}`;
		}
	} else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
		browserName = 'Chrome';
		const match = ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)/);
		if (match) {
			version = match[1];
			fullVersion = `${match[1]}.${match[2]}.${match[3]}`;
		}
	} else if (/Firefox\//.test(ua)) {
		browserName = 'Firefox';
		const match = ua.match(/Firefox\/(\d+)\.(\d+)/);
		if (match) {
			version = match[1];
			fullVersion = `${match[1]}.${match[2]}`;
		}
	} else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
		browserName = 'Safari';
		const match = ua.match(/Version\/(\d+)\.(\d+)/);
		if (match) {
			version = match[1];
			fullVersion = `${match[1]}.${match[2]}`;
		}
	}

	return {
		name: browserName,
		version,
		fullVersion,
		os,
		isMobile
	};
}

/**
 * Check if browser supports WebGPU based on version
 */
export function checkWebGPUBrowserSupport(): WebGPUSupport {
	const browserInfo = parseBrowserInfo();
	const majorVersion = parseInt(browserInfo.version, 10);

	let supported = false;
	let minimumVersion: string | null = null;
	let recommendation = '';
	let detailedIssue: string | null = null;

	switch (browserInfo.name) {
		case 'Chrome':
			minimumVersion = '113';
			if (majorVersion >= 113) {
				supported = true;
				recommendation = 'Your browser supports WebGPU!';
			} else {
				recommendation = `Update Chrome to version ${minimumVersion} or later`;
				detailedIssue = `Chrome ${browserInfo.version} does not support WebGPU. Minimum version required: ${minimumVersion}`;
			}
			break;

		case 'Edge':
			minimumVersion = '113';
			if (majorVersion >= 113) {
				supported = true;
				recommendation = 'Your browser supports WebGPU!';
			} else {
				recommendation = `Update Edge to version ${minimumVersion} or later`;
				detailedIssue = `Edge ${browserInfo.version} does not support WebGPU. Minimum version required: ${minimumVersion}`;
			}
			break;

		case 'Firefox':
			minimumVersion = '141';
			if (majorVersion >= 141) {
				supported = true;
				if (browserInfo.os === 'Windows') {
					recommendation = 'Your browser supports WebGPU by default!';
				} else {
					recommendation = 'Enable WebGPU in about:config: set dom.webgpu.enabled to true';
					detailedIssue = 'Firefox on Linux requires manual enabling: about:config → dom.webgpu.enabled → true';
				}
			} else {
				recommendation = `Update Firefox to version ${minimumVersion} or later`;
				detailedIssue = `Firefox ${browserInfo.version} does not support WebGPU. Minimum version required: ${minimumVersion}`;
			}
			break;

		case 'Safari':
			minimumVersion = '26';
			if (majorVersion >= 26) {
				supported = true;
				recommendation = 'Your browser supports WebGPU!';
			} else if (majorVersion >= 17) {
				supported = true;
				recommendation = 'WebGPU is available but may need enabling in Develop menu';
				detailedIssue = 'Safari 17-25: Enable Feature Flags → WebGPU in Develop menu';
			} else {
				recommendation = `Update Safari to version ${minimumVersion} or later`;
				detailedIssue = `Safari ${browserInfo.version} does not support WebGPU. Minimum version required: ${minimumVersion}`;
			}
			break;

		default:
			recommendation = 'Use Chrome 113+, Edge 113+, Firefox 141+, or Safari 26+ for WebGPU support';
			detailedIssue = `Unknown browser: ${browserInfo.name}. WebGPU requires Chrome 113+, Edge 113+, Firefox 141+, or Safari 26+`;
			break;
	}

	return {
		supported,
		browserInfo,
		minimumVersion,
		recommendation,
		detailedIssue
	};
}

/**
 * Get detailed WebGPU unavailability reason
 */
export function getWebGPUUnavailabilityReason(): string {
	if (!browser) return 'SSR context';

	// Check navigator.gpu
	if (typeof navigator.gpu === 'undefined') {
		const support = checkWebGPUBrowserSupport();
		if (support.detailedIssue) {
			return support.detailedIssue;
		}
		return 'navigator.gpu is undefined (browser does not support WebGPU)';
	}

	// Check secure context
	if (!window.isSecureContext) {
		return 'Not a secure context. WebGPU requires HTTPS or localhost.';
	}

	// If we get here, navigator.gpu exists but adapter request failed
	return 'WebGPU adapter request failed. GPU may not be available or browser may have blacklisted it.';
}

/**
 * Format browser info for display
 */
export function formatBrowserInfo(info: BrowserInfo): string {
	return `${info.name} ${info.fullVersion} on ${info.os}${info.isMobile ? ' (mobile)' : ''}`;
}

export default {
	parseBrowserInfo,
	checkWebGPUBrowserSupport,
	getWebGPUUnavailabilityReason,
	formatBrowserInfo
};
