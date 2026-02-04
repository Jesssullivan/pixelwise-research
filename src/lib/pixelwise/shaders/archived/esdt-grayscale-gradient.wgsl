// ESDT Grayscale and Gradient Computation
// Converts RGBA texture to grayscale levels and computes gradient direction
// using Sobel-like [1,2,1] kernel for smooth gradient estimation

struct Params {
    width: u32,
    height: u32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> grayscale: array<f32>;
@group(0) @binding(2) var<storage, read_write> gradient_x: array<f32>;
@group(0) @binding(3) var<storage, read_write> gradient_y: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

// Convert sRGB to linear RGB for proper grayscale conversion
// WCAG 2.1 specifies threshold 0.03928 (NOT 0.04045 from older sRGB spec)
fn srgb_to_linear(c: f32) -> f32 {
    if (c <= 0.03928) {
        return c / 12.92;
    } else {
        return pow((c + 0.055) / 1.055, 2.4);
    }
}

// Compute relative luminance (grayscale) from linear RGB
fn compute_luminance(color: vec3<f32>) -> f32 {
    let r_lin = srgb_to_linear(color.r);
    let g_lin = srgb_to_linear(color.g);
    let b_lin = srgb_to_linear(color.b);
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin;
}

// Sample texture with boundary clamping
fn sample_clamped(x: i32, y: i32) -> f32 {
    let px = clamp(x, 0, i32(params.width) - 1);
    let py = clamp(y, 0, i32(params.height) - 1);
    let color = textureLoad(input_texture, vec2<i32>(px, py), 0);
    return compute_luminance(color.rgb);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = i32(global_id.x);
    let y = i32(global_id.y);

    // Bounds check
    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let idx = global_id.y * params.width + global_id.x;

    // Compute grayscale value at current pixel
    let center = sample_clamped(x, y);
    grayscale[idx] = center;

    // Sobel-like gradient using [1,2,1] kernel
    // Horizontal gradient (Gx):
    //   -1  0  1
    //   -2  0  2
    //   -1  0  1
    let gx = (
        -1.0 * sample_clamped(x - 1, y - 1) +
        -2.0 * sample_clamped(x - 1, y    ) +
        -1.0 * sample_clamped(x - 1, y + 1) +
         1.0 * sample_clamped(x + 1, y - 1) +
         2.0 * sample_clamped(x + 1, y    ) +
         1.0 * sample_clamped(x + 1, y + 1)
    );

    // Vertical gradient (Gy):
    //   -1 -2 -1
    //    0  0  0
    //    1  2  1
    let gy = (
        -1.0 * sample_clamped(x - 1, y - 1) +
        -2.0 * sample_clamped(x    , y - 1) +
        -1.0 * sample_clamped(x + 1, y - 1) +
         1.0 * sample_clamped(x - 1, y + 1) +
         2.0 * sample_clamped(x    , y + 1) +
         1.0 * sample_clamped(x + 1, y + 1)
    );

    // Normalize by kernel sum (8.0 for Sobel)
    gradient_x[idx] = gx / 8.0;
    gradient_y[idx] = gy / 8.0;
}
