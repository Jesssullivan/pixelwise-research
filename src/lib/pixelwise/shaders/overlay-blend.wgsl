// Full-screen triangle overlay blend shader
//
// Renders a texture as an alpha-blended overlay. Uses a full-screen triangle
// generated from vertex_index (no vertex buffer needed). Discards fragments
// with near-zero alpha so the overlay is click-through on transparent regions.

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var overlay_sampler: sampler;
@group(0) @binding(1) var overlay_texture: texture_2d<f32>;

// Full-screen triangle from vertex index (covers [-1,1] clip space)
// Vertex 0: (-1, -1), Vertex 1: (3, -1), Vertex 2: (-1, 3)
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var out: VertexOutput;
  let x = f32(i32(vertex_index & 1u) * 4 - 1);
  let y = f32(i32(vertex_index >> 1u) * 4 - 1);
  out.position = vec4f(x, y, 0.0, 1.0);
  // UV: map clip [-1,1] to [0,1], flip Y for correct orientation
  out.uv = vec2f((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(overlay_texture, overlay_sampler, in.uv);
  // Discard near-transparent pixels (adjusted pixels have alpha > 0)
  if (color.a < 0.01) {
    discard;
  }
  return color;
}
