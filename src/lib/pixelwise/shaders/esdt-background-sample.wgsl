// ESDT Background Sampling
// Samples background color along SDF gradient direction
// Uses 5-point Gaussian kernel for smooth color estimation

struct Params {
    width: u32,
    height: u32,
    sample_distance: f32,  // Distance to sample along gradient
}

struct GlyphPixel {
    x: u32,
    y: u32,
    coverage: f32,
    edge_weight: f32,
    gradient_x: f32,  // Normalized gradient direction
    gradient_y: f32,
}

struct BackgroundSample {
    r: f32,
    g: f32,
    b: f32,
    valid: u32,  // 1 if sample is valid, 0 otherwise
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> glyph_pixels: array<GlyphPixel>;
@group(0) @binding(2) var<storage, read_write> background_samples: array<BackgroundSample>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> pixel_count: u32;

// 5-point Gaussian kernel weights (normalized to sum to 1.0)
// Kernel: [0.06136, 0.24477, 0.38774, 0.24477, 0.06136]
const KERNEL_WEIGHTS = array<f32, 5>(
    0.06136,
    0.24477,
    0.38774,
    0.24477,
    0.06136
);

// Sample texture with boundary checking
fn sample_texture(x: f32, y: f32) -> vec4<f32> {
    let px = i32(clamp(x, 0.0, f32(params.width - 1u)));
    let py = i32(clamp(y, 0.0, f32(params.height - 1u)));
    return textureLoad(input_texture, vec2<i32>(px, py), 0);
}

// Check if sample point is within image bounds
fn is_valid_sample(x: f32, y: f32) -> bool {
    return x >= 0.0 && x < f32(params.width) && y >= 0.0 && y < f32(params.height);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    if (idx >= pixel_count) {
        return;
    }

    let pixel = glyph_pixels[idx];

    // Sample along gradient direction
    // Direction points outward from glyph, so we sample along it to get background
    let center_x = f32(pixel.x);
    let center_y = f32(pixel.y);

    // 5 sample points along gradient at: -2σ, -σ, 0, +σ, +2σ
    // where σ = sample_distance / 2
    let sigma = params.sample_distance * 0.5;

    var total_weight = 0.0;
    var r_sum = 0.0;
    var g_sum = 0.0;
    var b_sum = 0.0;
    var any_valid = false;

    for (var i = 0; i < 5; i++) {
        // Offset along gradient: -2, -1, 0, 1, 2 times sigma
        let offset = (f32(i) - 2.0) * sigma;

        let sample_x = center_x + pixel.gradient_x * offset;
        let sample_y = center_y + pixel.gradient_y * offset;

        if (is_valid_sample(sample_x, sample_y)) {
            let color = sample_texture(sample_x, sample_y);
            let weight = KERNEL_WEIGHTS[i];

            r_sum += color.r * weight;
            g_sum += color.g * weight;
            b_sum += color.b * weight;
            total_weight += weight;
            any_valid = true;
        }
    }

    // Store weighted average background color
    if (any_valid && total_weight > 0.0) {
        background_samples[idx].r = r_sum / total_weight;
        background_samples[idx].g = g_sum / total_weight;
        background_samples[idx].b = b_sum / total_weight;
        background_samples[idx].valid = 1u;
    } else {
        // Fallback to center pixel if no valid samples
        let fallback = sample_texture(center_x, center_y);
        background_samples[idx].r = fallback.r;
        background_samples[idx].g = fallback.g;
        background_samples[idx].b = fallback.b;
        background_samples[idx].valid = 0u;
    }
}
