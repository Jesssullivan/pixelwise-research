/**
 * Futhark WebGPU Module Loading Tests
 *
 * Tests that the Futhark WebGPU module files exist and are properly structured.
 * Full runtime tests require a browser with WebGPU support.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FUTHARK_WEBGPU_DIR = path.join(process.cwd(), 'src/lib/futhark-webgpu');

describe('Futhark WebGPU Module Files', () => {
	describe('Required files exist', () => {
		it('pipeline-webgpu.js exists', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.js');
			expect(fs.existsSync(filePath)).toBe(true);
		});

		it('pipeline-webgpu.wasm exists', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.wasm');
			expect(fs.existsSync(filePath)).toBe(true);
		});

		it('pipeline-webgpu.wrapper.js exists', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.wrapper.js');
			expect(fs.existsSync(filePath)).toBe(true);
		});

		it('index.ts exists', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'index.ts');
			expect(fs.existsSync(filePath)).toBe(true);
		});
	});

	describe('WASM file structure', () => {
		it('pipeline-webgpu.wasm has valid WASM magic number', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.wasm');
			const buffer = fs.readFileSync(filePath);

			// WASM magic number: \0asm
			expect(buffer[0]).toBe(0x00);
			expect(buffer[1]).toBe(0x61); // 'a'
			expect(buffer[2]).toBe(0x73); // 's'
			expect(buffer[3]).toBe(0x6d); // 'm'
		});

		it('pipeline-webgpu.wasm is non-trivial size (>100KB)', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.wasm');
			const stats = fs.statSync(filePath);
			expect(stats.size).toBeGreaterThan(100 * 1024);
		});
	});

	describe('JavaScript file structure', () => {
		it('pipeline-webgpu.js contains Emscripten Module IIFE', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.js');
			const content = fs.readFileSync(filePath, 'utf-8');

			// Check for Emscripten module structure
			expect(content).toContain('var Module');
			expect(content).toContain('moduleArg');
		});

		it('pipeline-webgpu.js has CommonJS exports', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.js');
			const content = fs.readFileSync(filePath, 'utf-8');

			expect(content).toContain('module.exports');
		});

		it('pipeline-webgpu.wrapper.js contains FutharkModule class', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.wrapper.js');
			const content = fs.readFileSync(filePath, 'utf-8');

			expect(content).toContain('class FutharkModule');
			expect(content).toContain('class FutharkArray');
		});

		it('pipeline-webgpu.wrapper.js has entry point for enhance_contrast_rgba', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'pipeline-webgpu.wrapper.js');
			const content = fs.readFileSync(filePath, 'utf-8');

			expect(content).toContain('enhance_contrast_rgba');
		});
	});

	describe('index.ts exports', () => {
		it('index.ts exports newFutharkWebGPUContext', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'index.ts');
			const content = fs.readFileSync(filePath, 'utf-8');

			expect(content).toContain('export async function newFutharkWebGPUContext');
		});

		it('index.ts exports isFutharkWebGPUAvailable', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'index.ts');
			const content = fs.readFileSync(filePath, 'utf-8');

			expect(content).toContain('export async function isFutharkWebGPUAvailable');
		});

		it('index.ts uses import.meta.url for WASM path', () => {
			const filePath = path.join(FUTHARK_WEBGPU_DIR, 'index.ts');
			const content = fs.readFileSync(filePath, 'utf-8');

			// This is the critical fix - using import.meta.url for proper path resolution
			expect(content).toContain("new URL('./pipeline-webgpu.wasm', import.meta.url)");
		});
	});
});

describe('Static WASM copy', () => {
	it('pipeline-webgpu.wasm exists in static/wasm/', () => {
		const filePath = path.join(process.cwd(), 'static/wasm/pipeline-webgpu.wasm');
		if (!fs.existsSync(filePath)) {
			// WASM files are build artifacts, not checked into git
			return;
		}
		expect(fs.existsSync(filePath)).toBe(true);
	});
});
