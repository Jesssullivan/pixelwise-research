// ESDT Glyph Pixel Extraction V2
// Extracts glyph pixels from signed distance field with XYZ positioning
// Computes coverage, edge weight, and preserves subpixel coordinates

// =============================================================================
// V1 Structures (backward compatible)
// =============================================================================

struct Params {
    width: u32,
    height: u32,
    max_distance: f32,  // Maximum distance for normalization
}

struct DistanceData {
    delta_x: f32,
    delta_y: f32,
    distance: f32,
}

// V1 GlyphPixel - 24 bytes (6 x f32)
struct GlyphPixel {
    x: u32,
    y: u32,
    coverage: f32,      // 1 - d/max_distance, clamped [0,1]
    edge_weight: f32,   // 4 * coverage * (1 - coverage)
    gradient_x: f32,    // Normalized gradient direction (∇d_x)
    gradient_y: f32,    // Normalized gradient direction (∇d_y)
}

// =============================================================================
// V2 Extended Structures
// =============================================================================

// V2 Extended params
struct ParamsV2 {
    width: u32,
    height: u32,
    max_distance: f32,
    dpr: f32,               // Device pixel ratio
    texture_width: u32,     // Texture dimensions for UV calc
    texture_height: u32,
    feature_flags: u32,     // Feature enable bits
    padding: u32,
}

// V2 GlyphPixelV2 - Extended with XYZ positioning (48 bytes)
struct GlyphPixelV2 {
    // Subpixel-accurate position (physical pixels)
    x: f32,
    y: f32,
    frac_x: f32,        // Subpixel X offset [0, 1)
    frac_y: f32,        // Subpixel Y offset [0, 1)

    // Z-ordering
    z_index: u32,       // Effective z-index (shifted to unsigned)
    context_id: u32,    // Stacking context ID

    // ESDT-derived
    coverage: f32,
    edge_weight: f32,
    gradient_x: f32,
    gradient_y: f32,

    // Region reference
    region_id: u32,
    padding: u32,       // Align to 16-byte boundary
}

// Font metrics per region (24 bytes = 6 x f32)
struct FontMetrics {
    baseline: f32,      // Y offset of baseline from top
    ascent: f32,        // Pixels above baseline
    descent: f32,       // Pixels below baseline
    line_height: f32,   // Total line height
    em_size: f32,       // Font size in pixels
    flags: u32,         // Feature flags
}

// Feature flag constants
const FEATURE_XYZ_ENABLED: u32 = 0x01u;
const FEATURE_FONT_METRICS_ENABLED: u32 = 0x02u;
const FEATURE_STACKING_ENABLED: u32 = 0x04u;
const FEATURE_SUBPIXEL_ENABLED: u32 = 0x08u;

// =============================================================================
// Bindings - V1 Pipeline (default)
// =============================================================================

@group(0) @binding(0) var<storage, read> distances: array<DistanceData>;
@group(0) @binding(1) var<storage, read_write> glyph_pixels: array<GlyphPixel>;
@group(0) @binding(2) var<storage, read_write> pixel_count: atomic<u32>;
@group(0) @binding(3) var<uniform> params: Params;

// =============================================================================
// V1 Main Entry Point (backward compatible)
// =============================================================================

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    // Bounds check
    if (x >= params.width || y >= params.height) {
        return;
    }

    let idx = y * params.width + x;
    let dist_data = distances[idx];

    // Compute coverage: 1 - d/max_distance, clamped to [0, 1]
    let normalized_dist = dist_data.distance / params.max_distance;
    let coverage = clamp(1.0 - normalized_dist, 0.0, 1.0);

    // Only extract pixels with non-zero coverage
    if (coverage > 0.0) {
        // Compute edge weight: 4α(1-α)
        // This peaks at 1.0 when coverage = 0.5 (maximum edge)
        let edge_weight = 4.0 * coverage * (1.0 - coverage);

        // Compute normalized gradient direction
        let d = dist_data.distance;
        var grad_x = 0.0;
        var grad_y = 0.0;

        if (d > 0.0) {
            // ∇d = (Δx, Δy) / d
            grad_x = dist_data.delta_x / d;
            grad_y = dist_data.delta_y / d;
        }

        // Allocate slot in output array
        let output_idx = atomicAdd(&pixel_count, 1u);

        // Store glyph pixel data
        glyph_pixels[output_idx].x = x;
        glyph_pixels[output_idx].y = y;
        glyph_pixels[output_idx].coverage = coverage;
        glyph_pixels[output_idx].edge_weight = edge_weight;
        glyph_pixels[output_idx].gradient_x = grad_x;
        glyph_pixels[output_idx].gradient_y = grad_y;
    }
}

// =============================================================================
// V2 Helper Functions
// =============================================================================

// Sample texture with subpixel offset interpolation
// Uses bilinear weighting based on fractional position
fn sample_with_subpixel(
    base_x: f32,
    base_y: f32,
    frac_x: f32,
    frac_y: f32,
    tex_width: f32,
    tex_height: f32
) -> vec2<f32> {
    // Compute UV with subpixel offset for precise sampling
    // Add 0.5 for texel center sampling
    let precise_u = (base_x + frac_x + 0.5) / tex_width;
    let precise_v = (base_y + frac_y + 0.5) / tex_height;
    return vec2<f32>(precise_u, precise_v);
}

// Compute bilinear interpolation weights from fractional offsets
fn bilinear_weights(frac_x: f32, frac_y: f32) -> vec4<f32> {
    // Returns weights for: top-left, top-right, bottom-left, bottom-right
    let w_tl = (1.0 - frac_x) * (1.0 - frac_y);
    let w_tr = frac_x * (1.0 - frac_y);
    let w_bl = (1.0 - frac_x) * frac_y;
    let w_br = frac_x * frac_y;
    return vec4<f32>(w_tl, w_tr, w_bl, w_br);
}

// Check if pixel is visible based on z-ordering
// Returns true if this pixel should be processed (not occluded)
fn check_z_visibility(
    z_index: u32,
    context_id: u32,
    /* z_buffer or occlusion info would go here */
) -> bool {
    // Placeholder - actual implementation would check z-buffer
    // For now, all pixels are visible
    return true;
}

// =============================================================================
// V2 Extended Entry Point (separate pipeline)
// Would need additional bindings for V2 buffers
// =============================================================================

// Note: To use V2 features, create a separate compute pipeline with
// different bindings that include:
// - glyph_pixels_v2: array<GlyphPixelV2>
// - subpixel_coords: array<vec4<f32>> (x, y, fracX, fracY)
// - z_info: array<vec2<u32>> (z_index, context_id)
// - font_metrics: array<FontMetrics>
// - params_v2: ParamsV2

// Example V2 extraction (would be in a separate entry point):
//
// @compute @workgroup_size(8, 8)
// fn main_v2(@builtin(global_invocation_id) global_id: vec3<u32>) {
//     // ... V2 implementation with extended data
// }
