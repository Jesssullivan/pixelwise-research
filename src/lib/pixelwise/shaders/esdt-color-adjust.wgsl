// ESDT Color Adjustment
// Applies hue-preserving luminance adjustment with edge boost
// Maintains color relationships while improving contrast

struct Params {
    edge_boost_strength: f32,  // Strength of edge enhancement [0, 1]
}

struct GlyphPixel {
    x: u32,
    y: u32,
    coverage: f32,
    edge_weight: f32,
    gradient_x: f32,
    gradient_y: f32,
}

struct ContrastAnalysis {
    glyph_luminance: f32,
    background_luminance: f32,
    contrast_ratio: f32,
    adjustment_needed: f32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> glyph_pixels: array<GlyphPixel>;
@group(0) @binding(3) var<storage, read> contrast_analyses: array<ContrastAnalysis>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read> pixel_count: u32;

// WCAG 2.1 linearization constants
const LINEARIZATION_THRESHOLD: f32 = 0.03928;
const LINEARIZATION_DIVISOR: f32 = 12.92;
const GAMMA: f32 = 2.4;
const GAMMA_OFFSET: f32 = 0.055;
const GAMMA_SCALE: f32 = 1.055;

// Convert sRGB to linear
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= LINEARIZATION_THRESHOLD) {
        return c / LINEARIZATION_DIVISOR;
    } else {
        return pow((c + GAMMA_OFFSET) / GAMMA_SCALE, GAMMA);
    }
}

// Convert linear to sRGB
fn linear_to_srgb(c: f32) -> f32 {
    if (c <= 0.0031308) {
        return c * LINEARIZATION_DIVISOR;
    } else {
        return GAMMA_SCALE * pow(c, 1.0 / GAMMA) - GAMMA_OFFSET;
    }
}

// Compute relative luminance
fn compute_luminance(color: vec3<f32>) -> f32 {
    let r_lin = srgb_to_linear(color.r);
    let g_lin = srgb_to_linear(color.g);
    let b_lin = srgb_to_linear(color.b);
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin;
}

// Hue-preserving luminance adjustment
// Scales RGB proportionally to achieve target luminance
fn adjust_luminance(color: vec3<f32>, target_luminance: f32) -> vec3<f32> {
    let current_luminance = compute_luminance(color);

    // Avoid division by zero - for very dark colors, return a grey at target luminance
    if (current_luminance < 0.0001) {
        // Convert target luminance to sRGB grey (preserving perceptual brightness)
        let grey = linear_to_srgb(clamp(target_luminance, 0.0, 1.0));
        return vec3<f32>(grey, grey, grey);
    }

    // Convert to linear RGB
    let r_lin = srgb_to_linear(color.r);
    let g_lin = srgb_to_linear(color.g);
    let b_lin = srgb_to_linear(color.b);

    // Scale linear RGB to achieve target luminance
    let scale = target_luminance / current_luminance;

    // Clamp scale to prevent extreme adjustments (max 10x brightening or darkening)
    let clamped_scale = clamp(scale, 0.1, 10.0);

    let r_new = clamp(r_lin * clamped_scale, 0.0, 1.0);
    let g_new = clamp(g_lin * clamped_scale, 0.0, 1.0);
    let b_new = clamp(b_lin * clamped_scale, 0.0, 1.0);

    // Convert back to sRGB
    return vec3<f32>(
        linear_to_srgb(r_new),
        linear_to_srgb(g_new),
        linear_to_srgb(b_new)
    );
}

// Apply edge boost: sharpen edges using edge weight
fn apply_edge_boost(
    color: vec3<f32>,
    adjusted_color: vec3<f32>,
    edge_weight: f32,
    boost_strength: f32
) -> vec3<f32> {
    // Edge boost interpolates between adjusted color and more extreme version
    // Higher edge_weight (closer to edge) = more boost
    let boost_factor = 1.0 + edge_weight * boost_strength;

    let r = clamp(adjusted_color.r * boost_factor, 0.0, 1.0);
    let g = clamp(adjusted_color.g * boost_factor, 0.0, 1.0);
    let b = clamp(adjusted_color.b * boost_factor, 0.0, 1.0);

    return vec3<f32>(r, g, b);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    if (idx >= pixel_count) {
        return;
    }

    let pixel = glyph_pixels[idx];
    let analysis = contrast_analyses[idx];

    // Only process pixels that actually need adjustment
    // Skip if adjustment factor is essentially 1.0 (no change needed)
    if (abs(analysis.adjustment_needed - 1.0) < 0.001) {
        return;
    }

    // Load original color
    let original = textureLoad(
        input_texture,
        vec2<i32>(i32(pixel.x), i32(pixel.y)),
        0
    );

    // Compute target luminance
    let target_lum = analysis.glyph_luminance * analysis.adjustment_needed;

    // Adjust luminance while preserving hue
    var adjusted = adjust_luminance(original.rgb, target_lum);

    // Apply edge boost at glyph boundaries
    if (params.edge_boost_strength > 0.0 && pixel.edge_weight > 0.0) {
        adjusted = apply_edge_boost(
            original.rgb,
            adjusted,
            pixel.edge_weight,
            params.edge_boost_strength
        );
    }

    // Write adjusted color to output texture with alpha=1.0 to mark as adjusted
    // (The overlay compositor uses alpha to determine which pixels to blend)
    textureStore(
        output_texture,
        vec2<i32>(i32(pixel.x), i32(pixel.y)),
        vec4<f32>(adjusted, 1.0)
    );
}
