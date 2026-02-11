// Video Capture Fallback - Regular Texture to RGBA
//
// Minimal shader: imports a video frame from texture_2d and writes
// packed RGBA u32 values to a storage buffer. All further processing
// (grayscale, Sobel, ESDT, WCAG contrast) is handled by Futhark via
// runFullPipeline().
//
// Fallback version for browsers without importExternalTexture support
// (e.g., Firefox). Uses texture_2d instead of texture_external.

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> rgba_output: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

struct Params {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    // Use textureLoad for regular textures (integer coordinates)
    let color = textureLoad(videoTexture, vec2<i32>(i32(global_id.x), i32(global_id.y)), 0);

    // Pack RGBA into u32: R in low byte, A in high byte
    let r = u32(clamp(color.r * 255.0, 0.0, 255.0));
    let g = u32(clamp(color.g * 255.0, 0.0, 255.0));
    let b = u32(clamp(color.b * 255.0, 0.0, 255.0));
    let a = u32(clamp(color.a * 255.0, 0.0, 255.0));

    let idx = global_id.y * params.width + global_id.x;
    rgba_output[idx] = r | (g << 8u) | (b << 16u) | (a << 24u);
}
