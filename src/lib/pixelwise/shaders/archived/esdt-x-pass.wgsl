// ESDT Horizontal (X) Propagation Pass
// Implements forward and backward 1D distance transform along rows
// Maintains offset vectors (Δx, Δy) for exact signed distance computation
//
// Key difference from binary EDT: gray pixels (0 < level < 1) get sub-pixel
// offsets based on gradient direction, preserving anti-aliased edge accuracy.

struct Params {
    width: u32,
    height: u32,
    _padding: u32,  // Alignment padding (unused)
}

struct DistanceData {
    delta_x: f32,  // Horizontal offset to nearest edge
    delta_y: f32,  // Vertical offset to nearest edge
    distance: f32, // Euclidean distance = sqrt(Δx² + Δy²)
}

@group(0) @binding(0) var<storage, read> grayscale: array<f32>;
@group(0) @binding(1) var<storage, read_write> distances: array<DistanceData>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> gradient_x: array<f32>;
@group(0) @binding(4) var<storage, read> gradient_y: array<f32>;

const INF: f32 = 1e10;

// Initialize distance data for a pixel using sub-pixel offset for gray pixels
// This is the key to ESDT's "Exact" - preserving anti-aliased edge accuracy
fn initialize_pixel(gray: f32, gx: f32, gy: f32) -> DistanceData {
    var data: DistanceData;

    if (gray <= 0.0) {
        // Background pixel: infinite distance to edge
        data.delta_x = INF;
        data.delta_y = INF;
        data.distance = INF;
    } else if (gray >= 1.0) {
        // Foreground pixel: inside glyph, zero distance
        data.delta_x = 0.0;
        data.delta_y = 0.0;
        data.distance = 0.0;
    } else {
        // Gray (edge) pixel: sub-pixel offset in gradient direction
        // The gradient points toward increasing luminance (into the glyph)
        // offset = (level - 0.5) gives signed distance from edge center
        let grad_len = sqrt(gx * gx + gy * gy);
        if (grad_len > 0.001) {
            // Normalize gradient and scale by offset from edge midpoint
            let norm_gx = gx / grad_len;
            let norm_gy = gy / grad_len;
            let offset = gray - 0.5;
            data.delta_x = offset * norm_gx;
            data.delta_y = offset * norm_gy;
            data.distance = abs(offset);
        } else {
            // Zero gradient (flat region): treat as threshold crossing
            // This shouldn't happen often with proper anti-aliased text
            data.delta_x = 0.0;
            data.delta_y = 0.0;
            data.distance = 0.0;
        }
    }

    return data;
}

// Compare and propagate distance information
fn update_distance(current: DistanceData, neighbor: DistanceData, offset_x: f32) -> DistanceData {
    // Compute new offset if we propagate from neighbor
    let new_dx = neighbor.delta_x + offset_x;
    let new_dy = neighbor.delta_y;
    let new_dist = sqrt(new_dx * new_dx + new_dy * new_dy);

    // Keep the shorter distance
    if (new_dist < current.distance) {
        var updated: DistanceData;
        updated.delta_x = new_dx;
        updated.delta_y = new_dy;
        updated.distance = new_dist;
        return updated;
    }

    return current;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let y = global_id.x;

    if (y >= params.height) {
        return;
    }

    let row_start = y * params.width;

    // Initialize all pixels in this row with sub-pixel offsets
    for (var x = 0u; x < params.width; x++) {
        let idx = row_start + x;
        distances[idx] = initialize_pixel(grayscale[idx], gradient_x[idx], gradient_y[idx]);
    }

    // Forward pass (left to right)
    for (var x = 1u; x < params.width; x++) {
        let idx = row_start + x;
        let prev_idx = idx - 1u;

        let current = distances[idx];
        let prev = distances[prev_idx];

        distances[idx] = update_distance(current, prev, 1.0);
    }

    // Backward pass (right to left)
    for (var x = params.width - 1u; x > 0u; x--) {
        let idx = row_start + x - 1u;
        let next_idx = idx + 1u;

        let current = distances[idx];
        let next = distances[next_idx];

        distances[idx] = update_distance(current, next, -1.0);
    }
}
