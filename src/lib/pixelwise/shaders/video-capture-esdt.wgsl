// Video Capture - External Texture to RGBA
//
// Minimal shader: imports a video frame from GPUExternalTexture and
// writes packed RGBA u32 values to a storage buffer. All further
// processing (grayscale, Sobel, ESDT, WCAG contrast) is handled by
// Futhark via runFullPipeline().
//
// This shader uses texture_external for zero-copy video frame access
// (Chrome/Safari). Firefox requires the fallback texture_2d version.

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_external;
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

    // Compute UV coordinates (texel center)
    let uv = vec2<f32>(
        (f32(global_id.x) + 0.5) / f32(params.width),
        (f32(global_id.y) + 0.5) / f32(params.height)
    );

    // Sample with BaseClampToEdge (required for external textures)
    let color = textureSampleBaseClampToEdge(videoTexture, videoSampler, uv);

    // Pack RGBA into u32: R in low byte, A in high byte
    let r = u32(clamp(color.r * 255.0, 0.0, 255.0));
    let g = u32(clamp(color.g * 255.0, 0.0, 255.0));
    let b = u32(clamp(color.b * 255.0, 0.0, 255.0));
    let a = u32(clamp(color.a * 255.0, 0.0, 255.0));

    let idx = global_id.y * params.width + global_id.x;
    rgba_output[idx] = r | (g << 8u) | (b << 16u) | (a << 24u);
}
