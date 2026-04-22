declare module 'virtual:pixelwise-pulsing' {
	export interface PulsingEngineOptions {
		canvas: HTMLCanvasElement;
		textColor?: string;
		wcagLevel?: string;
	}

	export interface ComplianceMetrics {
		wcagLevel: string;
		isCompliant: boolean;
		pulseMode: string;
		minContrast: number;
	}

	export class PulsingEngine {
		constructor(options: PulsingEngineOptions);
		canvas: HTMLCanvasElement;
		textColor: string;
		wcagLevel: string;
		gl: WebGL2RenderingContext | null;
		isInitialized: boolean;
		initialize(): void;
		updateTexture(imageData: { width: number; height: number; data: ArrayBufferView }): void;
		updateState(state: Record<string, unknown>): void;
		render(): void;
		start(): void;
		stop(): void;
		getComplianceMetrics(): ComplianceMetrics;
		get pulseMode(): string;
		set pulseMode(mode: string);
		destroy(): void;
	}

	const pulsingModule: {
		PulsingEngine: typeof PulsingEngine;
	};

	export default pulsingModule;
}
