// Video Capture ESDT Fallback - Regular Texture Input Shader
//
// Fallback version for browsers without importExternalTexture support
// (e.g., Firefox as of February 2026). Uses texture_2d instead of
// texture_external.
//
// This shader is functionally identical to video-capture-esdt.wgsl
// but uses different texture sampling functions.
//
// Pipeline position: Pass 1 (before ESDT X/Y passes)

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> grayscale: array<f32>;
@group(0) @binding(3) var<storage, read_write> gradient_x: array<f32>;
@group(0) @binding(4) var<storage, read_write> gradient_y: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
    dpr: f32,
    padding: u32,
}

// ============================================================================
// WCAG 2.1 Color Space Functions (Exact Constants)
// ============================================================================

fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.03928) {
        return c / 12.92;
    }
    return pow((c + 0.055) / 1.055, 2.4);
}

fn relative_luminance(rgb: vec3<f32>) -> f32 {
    let lin = vec3<f32>(
        srgb_to_linear(rgb.r),
        srgb_to_linear(rgb.g),
        srgb_to_linear(rgb.b)
    );
    return 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
}

// ============================================================================
// Video Sampling (Regular Texture Version)
// ============================================================================

// Sample regular texture with textureLoad (integer coords)
fn sample_video(x: i32, y: i32) -> f32 {
    let px = clamp(x, 0, i32(params.width) - 1);
    let py = clamp(y, 0, i32(params.height) - 1);

    // Use textureLoad for regular textures
    let color = textureLoad(videoTexture, vec2<i32>(px, py), 0);

    return relative_luminance(color.rgb);
}

fn sample_video_inverted(x: i32, y: i32) -> f32 {
    return 1.0 - sample_video(x, y);
}

// ============================================================================
// Gradient Computation
// ============================================================================

fn compute_sobel_gradient(x: i32, y: i32) -> vec2<f32> {
    let s00 = sample_video_inverted(x - 1, y - 1);
    let s10 = sample_video_inverted(x    , y - 1);
    let s20 = sample_video_inverted(x + 1, y - 1);
    let s01 = sample_video_inverted(x - 1, y    );
    let s21 = sample_video_inverted(x + 1, y    );
    let s02 = sample_video_inverted(x - 1, y + 1);
    let s12 = sample_video_inverted(x    , y + 1);
    let s22 = sample_video_inverted(x + 1, y + 1);

    let gx = (
        -1.0 * s00 + 1.0 * s20 +
        -2.0 * s01 + 2.0 * s21 +
        -1.0 * s02 + 1.0 * s22
    );

    let gy = (
        -1.0 * s00 - 2.0 * s10 - 1.0 * s20 +
         1.0 * s02 + 2.0 * s12 + 1.0 * s22
    );

    return vec2<f32>(gx, gy) / 8.0;
}

fn normalize_gradient(grad: vec2<f32>) -> vec2<f32> {
    let mag = length(grad);
    if (mag < 0.001) {
        return vec2<f32>(0.0, 0.0);
    }
    return grad / mag;
}

// ============================================================================
// Main Compute Shader
// ============================================================================

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = i32(global_id.x);
    let y = i32(global_id.y);

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let idx = global_id.y * params.width + global_id.x;

    let luminance = sample_video_inverted(x, y);
    grayscale[idx] = luminance;

    let grad = compute_sobel_gradient(x, y);
    let norm_grad = normalize_gradient(grad);

    gradient_x[idx] = norm_grad.x;
    gradient_y[idx] = norm_grad.y;
}
