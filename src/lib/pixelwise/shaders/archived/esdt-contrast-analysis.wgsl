// ESDT Contrast Analysis
// Computes WCAG 2.1 contrast ratios between glyph and background
// Uses CORRECT linearization threshold (0.03928) and exponent (2.4)

struct Params {
    target_contrast: f32,  // Target WCAG contrast ratio (e.g., 4.5 or 7.0)
}

struct GlyphPixel {
    x: u32,
    y: u32,
    coverage: f32,
    edge_weight: f32,
    gradient_x: f32,
    gradient_y: f32,
}

struct BackgroundSample {
    r: f32,
    g: f32,
    b: f32,
    valid: u32,
}

struct ContrastAnalysis {
    glyph_luminance: f32,
    background_luminance: f32,
    contrast_ratio: f32,
    adjustment_needed: f32,  // Multiplicative factor needed to reach target
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> glyph_pixels: array<GlyphPixel>;
@group(0) @binding(2) var<storage, read> background_samples: array<BackgroundSample>;
@group(0) @binding(3) var<storage, read_write> contrast_analyses: array<ContrastAnalysis>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read> pixel_count: u32;

// CORRECT linearization threshold per WCAG 2.1 specification
const LINEARIZATION_THRESHOLD: f32 = 0.03928;
const LINEARIZATION_DIVISOR: f32 = 12.92;
const GAMMA: f32 = 2.4;
const GAMMA_OFFSET: f32 = 0.055;
const GAMMA_SCALE: f32 = 1.055;

// Convert sRGB component to linear RGB
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= LINEARIZATION_THRESHOLD) {
        return c / LINEARIZATION_DIVISOR;
    } else {
        return pow((c + GAMMA_OFFSET) / GAMMA_SCALE, GAMMA);
    }
}

// Compute relative luminance from sRGB color
fn compute_luminance(color: vec3<f32>) -> f32 {
    let r_lin = srgb_to_linear(color.r);
    let g_lin = srgb_to_linear(color.g);
    let b_lin = srgb_to_linear(color.b);

    // WCAG 2.1 luminance coefficients
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin;
}

// Compute WCAG contrast ratio
fn compute_contrast_ratio(l1: f32, l2: f32) -> f32 {
    let lighter = max(l1, l2);
    let darker = min(l1, l2);

    // CR = (L_lighter + 0.05) / (L_darker + 0.05)
    return (lighter + 0.05) / (darker + 0.05);
}

// Compute adjustment factor needed to reach target contrast
fn compute_adjustment(current_ratio: f32, target_ratio: f32, glyph_lum: f32, bg_lum: f32) -> f32 {
    // If already meeting target, no adjustment needed
    if (current_ratio >= target_ratio) {
        return 1.0;
    }

    // Determine if we need to darken or lighten
    let glyph_is_lighter = glyph_lum > bg_lum;

    // Compute required luminance for target contrast
    // If glyph is lighter: L_glyph_new = target * (L_bg + 0.05) - 0.05
    // If glyph is darker:  L_glyph_new = (L_bg + 0.05) / target - 0.05
    var target_luminance: f32;
    if (glyph_is_lighter) {
        target_luminance = target_ratio * (bg_lum + 0.05) - 0.05;
    } else {
        target_luminance = (bg_lum + 0.05) / target_ratio - 0.05;
    }

    // Clamp to valid luminance range [0, 1]
    target_luminance = clamp(target_luminance, 0.0, 1.0);

    // Compute multiplicative adjustment factor
    if (glyph_lum > 0.0) {
        return target_luminance / glyph_lum;
    } else {
        return 1.0;
    }
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    if (idx >= pixel_count) {
        return;
    }

    let pixel = glyph_pixels[idx];
    let background = background_samples[idx];

    // Get glyph color from texture
    let glyph_color = textureLoad(
        input_texture,
        vec2<i32>(i32(pixel.x), i32(pixel.y)),
        0
    );

    // Compute luminances
    let glyph_lum = compute_luminance(glyph_color.rgb);
    let bg_lum = compute_luminance(vec3<f32>(background.r, background.g, background.b));

    // Compute contrast ratio
    let contrast = compute_contrast_ratio(glyph_lum, bg_lum);

    // Compute adjustment factor
    let adjustment = compute_adjustment(contrast, params.target_contrast, glyph_lum, bg_lum);

    // Store analysis results
    contrast_analyses[idx].glyph_luminance = glyph_lum;
    contrast_analyses[idx].background_luminance = bg_lum;
    contrast_analyses[idx].contrast_ratio = contrast;
    contrast_analyses[idx].adjustment_needed = adjustment;
}
