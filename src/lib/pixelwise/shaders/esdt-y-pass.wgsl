// ESDT Vertical (Y) Propagation Pass
// Implements forward and backward 1D distance transform along columns
// Completes the 2D ESDT by propagating vertically after horizontal pass

struct Params {
    width: u32,
    height: u32,
}

struct DistanceData {
    delta_x: f32,  // Horizontal offset to nearest edge
    delta_y: f32,  // Vertical offset to nearest edge
    distance: f32, // Euclidean distance = sqrt(Δx² + Δy²)
}

@group(0) @binding(0) var<storage, read_write> distances: array<DistanceData>;
@group(0) @binding(1) var<uniform> params: Params;

// Compare and propagate distance information
fn update_distance(current: DistanceData, neighbor: DistanceData, offset_y: f32) -> DistanceData {
    // Compute new offset if we propagate from neighbor
    let new_dx = neighbor.delta_x;
    let new_dy = neighbor.delta_y + offset_y;
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
    let x = global_id.x;

    if (x >= params.width) {
        return;
    }

    // Forward pass (top to bottom)
    for (var y = 1u; y < params.height; y++) {
        let idx = y * params.width + x;
        let prev_idx = (y - 1u) * params.width + x;

        let current = distances[idx];
        let prev = distances[prev_idx];

        distances[idx] = update_distance(current, prev, 1.0);
    }

    // Backward pass (bottom to top)
    for (var y = params.height - 1u; y > 0u; y--) {
        let idx = (y - 1u) * params.width + x;
        let next_idx = y * params.width + x;

        let current = distances[idx];
        let next = distances[next_idx];

        distances[idx] = update_distance(current, next, -1.0);
    }
}
