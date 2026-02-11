-- Pixelwise Contrast Enhancement Pipeline
--
-- 6-pass pipeline for WCAG-compliant text contrast enhancement:
-- 1. Grayscale + Sobel gradient
-- 2. ESDT X-pass (horizontal distance propagation)
-- 3. ESDT Y-pass (vertical distance propagation)
-- 4. Glyph extraction (distance < threshold -> glyph pixel)
-- 5. Background sampling (outward along gradient direction)
-- 6. WCAG contrast check + color adjustment
--
-- This module composes esdt.fut and wcag.fut into a complete pipeline.

import "esdt"
import "wcag"

-- RGBA pixel type (8-bit per channel)
type rgba = {r: u8, g: u8, b: u8, a: u8}

-- Pipeline configuration
type config = {
  max_distance: f32,      -- Max distance for glyph inclusion
  target_contrast: f32,   -- Target WCAG contrast ratio (e.g., 7.0 for AAA)
  sample_distance: f32,   -- How far to sample for background
  use_relaxation: bool    -- Use ESDT relaxation pass
}

-- Default config for WCAG AAA compliance
def default_config: config = {
  max_distance = 3.0f32,
  target_contrast = 7.0f32,
  sample_distance = 5.0f32,
  use_relaxation = false
}

-- Pass 1: Convert RGBA to grayscale levels
-- Uses perceptual luminance weights
def pass_grayscale [h][w] (image: [h][w]rgba): [h][w]f32 =
  map (map (\px ->
    let r = f32.u8 px.r / 255f32
    let g = f32.u8 px.g / 255f32
    let b = f32.u8 px.b / 255f32
    -- Perceptual luminance (same weights as WCAG)
    in 0.2126f32 * r + 0.7152f32 * g + 0.0722f32 * b
  )) image

-- Pass 2-3: ESDT (combined X and Y passes)
def pass_esdt [h][w] (levels: [h][w]f32) (cfg: config): [h][w]esdt_pixel =
  compute_esdt levels cfg.use_relaxation

-- Pass 4: Extract glyph pixel mask
-- Returns per-pixel: (is_glyph, coverage, edge_weight, grad_x, grad_y)
type glyph_mask = {
  is_glyph: bool,
  coverage: f32,
  edge_weight: f32,
  grad_x: f32,
  grad_y: f32
}

def pass_extract_glyphs [h][w] (esdt: [h][w]esdt_pixel) (cfg: config): [h][w]glyph_mask =
  map (map (\px ->
    let d = distance px
    let (gx, gy) = gradient px
    let coverage = f32.max 0f32 (f32.min 1f32 (1f32 - d / cfg.max_distance))
    let edge_weight = 4f32 * coverage * (1f32 - coverage)
    in {
      is_glyph = d < cfg.max_distance && coverage > 0.02f32,
      coverage,
      edge_weight,
      grad_x = gx,
      grad_y = gy
    }
  )) esdt

-- Pass 5: Sample background along gradient direction
-- For each glyph pixel, sample outward to find background color
-- For pixels with zero gradient (solid interior), we need to find background differently
def pass_sample_background [h][w] (image: [h][w]rgba) (mask: [h][w]glyph_mask) (esdt: [h][w]esdt_pixel) (cfg: config): [h][w]rgba =
  map2 (\y row_mask ->
    map2 (\x glyph ->
      if !glyph.is_glyph
      then {r = 0u8, g = 0u8, b = 0u8, a = 0u8}  -- Not a glyph, no background needed
      else
        -- Check if gradient is near-zero (solid interior pixel)
        let grad_len = f32.sqrt (glyph.grad_x * glyph.grad_x + glyph.grad_y * glyph.grad_y)
        in if grad_len < 0.1f32
           then
             -- Solid interior: no adjustment needed (already has good contrast internally)
             -- Return a sentinel value that indicates "no background sample available"
             {r = 255u8, g = 255u8, b = 255u8, a = 0u8}  -- Alpha=0 marks invalid sample
           else
             -- Sample in gradient direction (outward from glyph)
             let sample_x = i64.f32 (f32.round (f32.i64 x + glyph.grad_x * cfg.sample_distance))
             let sample_y = i64.f32 (f32.round (f32.i64 y + glyph.grad_y * cfg.sample_distance))
             let sx = i64.max 0 (i64.min (w - 1) sample_x)
             let sy = i64.max 0 (i64.min (h - 1) sample_y)
             in image[sy, sx]
    ) (iota w) row_mask
  ) (iota h) mask

-- Pass 6: WCAG contrast check and color adjustment
-- Returns adjusted colors for glyph pixels that fail contrast check
type adjustment = {
  needs_adjustment: bool,
  original_contrast: f32,
  adjusted_r: u8,
  adjusted_g: u8,
  adjusted_b: u8
}

def pass_adjust_contrast [h][w]
    (image: [h][w]rgba)
    (mask: [h][w]glyph_mask)
    (backgrounds: [h][w]rgba)
    (cfg: config): [h][w]adjustment =
  map3 (\row_img row_mask row_bg ->
    map3 (\px glyph bg ->
      if !glyph.is_glyph
      then {
        needs_adjustment = false,
        original_contrast = 0f32,
        adjusted_r = 0u8,
        adjusted_g = 0u8,
        adjusted_b = 0u8
      }
      else if bg.a == 0u8
      then
        -- No valid background sample (solid interior pixel)
        -- Don't adjust these pixels
        {
          needs_adjustment = false,
          original_contrast = 21f32,  -- Assume max contrast for interior
          adjusted_r = px.r,
          adjusted_g = px.g,
          adjusted_b = px.b
        }
      else
        let cr = contrast_ratio_rgb px.r px.g px.b bg.r bg.g bg.b
        in if cr >= cfg.target_contrast
           then {
             needs_adjustment = false,
             original_contrast = cr,
             adjusted_r = px.r,
             adjusted_g = px.g,
             adjusted_b = px.b
           }
           else
             let (r, g, b) = find_compliant_color px.r px.g px.b bg.r bg.g bg.b cfg.target_contrast
             in {
               needs_adjustment = true,
               original_contrast = cr,
               adjusted_r = r,
               adjusted_g = g,
               adjusted_b = b
             }
    ) row_img row_mask row_bg
  ) image mask backgrounds

-- Complete pipeline: returns adjusted image
def run_pipeline [h][w] (image: [h][w]rgba) (cfg: config): [h][w]rgba =
  let levels = pass_grayscale image
  let esdt = pass_esdt levels cfg
  let mask = pass_extract_glyphs esdt cfg
  let backgrounds = pass_sample_background image mask esdt cfg
  let adjustments = pass_adjust_contrast image mask backgrounds cfg
  -- Apply adjustments
  in map2 (\row_img row_adj ->
    map2 (\px adj ->
      if adj.needs_adjustment
      then {r = adj.adjusted_r, g = adj.adjusted_g, b = adj.adjusted_b, a = px.a}
      else px
    ) row_img row_adj
  ) image adjustments

-- Pipeline statistics
type stats = {
  total_pixels: i64,
  glyph_pixels: i64,
  adjusted_pixels: i64,
  avg_original_contrast: f32,
  min_original_contrast: f32
}

def compute_stats [h][w] (mask: [h][w]glyph_mask) (adjustments: [h][w]adjustment): stats =
  let flat_mask = flatten mask
  let flat_adj = flatten adjustments
  let n = h * w
  let glyph_count = length (filter (\m -> m.is_glyph) flat_mask)
  let adjusted_count = length (filter (\a -> a.needs_adjustment) flat_adj)
  let contrasts = map (\a -> if a.original_contrast > 0f32 then a.original_contrast else 21f32) flat_adj
  let total_contrast = reduce (+) 0f32 contrasts
  let min_contrast = reduce f32.min 21f32 contrasts
  in {
    total_pixels = n,
    glyph_pixels = glyph_count,
    adjusted_pixels = adjusted_count,
    avg_original_contrast = total_contrast / f32.i64 n,
    min_original_contrast = min_contrast
  }

-- Entry points

-- Run full pipeline on flat RGBA array
-- Input: [h*w*4] u8 as [r, g, b, a, r, g, b, a, ...]
-- Output: [h*w*4] u8 adjusted image
entry enhance_contrast_rgba [n]
    (image_flat: [n]u8)
    (width: i64) (height: i64)
    (target_contrast: f32)
    (max_distance: f32)
    (sample_distance: f32): []u8 =
  let cfg = {
    max_distance,
    target_contrast,
    sample_distance,
    use_relaxation = false
  }
  -- Convert flat to 2D RGBA
  let image_2d: [height][width]rgba =
    tabulate_2d height width (\y x ->
      let idx = (y * width + x) * 4
      in {
        r = image_flat[idx],
        g = image_flat[idx + 1],
        b = image_flat[idx + 2],
        a = image_flat[idx + 3]
      }
    )
  let result = run_pipeline image_2d cfg
  -- Flatten back to [r, g, b, a, ...]
  in flatten (map (map (\px -> [px.r, px.g, px.b, px.a])) result)
     |> flatten

-- Get pipeline intermediate results (for debugging)
entry debug_esdt [h][w] (image: [h][w]rgba) (max_distance: f32): []f32 =
  let levels = pass_grayscale image
  let cfg = {max_distance, target_contrast = 7f32, sample_distance = 5f32, use_relaxation = false}
  let esdt = pass_esdt levels cfg
  in flatten (map (map (\p -> [p.delta_x, p.delta_y])) esdt) |> flatten

-- Compute ESDT from flat RGBA array (for WebGPU gradient visualization)
-- Same as debug_esdt but accepts flat u8 RGBA input (no opaque type construction needed)
-- Input: [h*w*4] u8 as [r, g, b, a, r, g, b, a, ...]
-- Output: [h*w*2] f32 as [delta_x, delta_y, delta_x, delta_y, ...]
entry debug_esdt_flat [n]
    (image_flat: [n]u8)
    (width: i64) (height: i64)
    (max_distance: f32): []f32 =
  let image_2d: [height][width]rgba =
    tabulate_2d height width (\y x ->
      let idx = (y * width + x) * 4
      in {
        r = image_flat[idx],
        g = image_flat[idx + 1],
        b = image_flat[idx + 2],
        a = image_flat[idx + 3]
      }
    )
  let levels = pass_grayscale image_2d
  let cfg = {max_distance, target_contrast = 7f32, sample_distance = 5f32, use_relaxation = false}
  let esdt = pass_esdt levels cfg
  in flatten (map (map (\p -> [p.delta_x, p.delta_y])) esdt) |> flatten

-- Debug visualization: Distance heatmap
-- Maps ESDT distance to a heat color: blue (far) -> green -> yellow -> red (close)
-- Input: [h*w*4] u8 RGBA, Output: [h*w*4] u8 RGBA heatmap
entry debug_distance_heatmap [n]
    (image_flat: [n]u8)
    (width: i64) (height: i64)
    (max_distance: f32): []u8 =
  let image_2d: [height][width]rgba =
    tabulate_2d height width (\y x ->
      let idx = (y * width + x) * 4
      in {
        r = image_flat[idx],
        g = image_flat[idx + 1],
        b = image_flat[idx + 2],
        a = image_flat[idx + 3]
      }
    )
  let levels = pass_grayscale image_2d
  let cfg = {max_distance, target_contrast = 7f32, sample_distance = 5f32, use_relaxation = false}
  let esdt = pass_esdt levels cfg
  -- Map distance to RGBA heatmap
  let heatmap = map (map (\px ->
    let d = distance px
    let t = f32.min 1f32 (d / max_distance)
    -- Color ramp: red (0) -> yellow (0.33) -> green (0.66) -> blue (1)
    let r = u8.f32 (f32.min 255f32 (f32.max 0f32 (
      if t < 0.5f32 then 255f32 * (1f32 - t * 2f32)
      else 0f32
    )))
    let g = u8.f32 (f32.min 255f32 (f32.max 0f32 (
      if t < 0.5f32 then 255f32 * t * 2f32
      else 255f32 * (1f32 - (t - 0.5f32) * 2f32)
    )))
    let b = u8.f32 (f32.min 255f32 (f32.max 0f32 (
      if t < 0.5f32 then 0f32
      else 255f32 * (t - 0.5f32) * 2f32
    )))
    in {r, g, b, a = 255u8}
  )) esdt
  in flatten (map (map (\px -> [px.r, px.g, px.b, px.a])) heatmap) |> flatten

-- Debug visualization: Binary glyph mask
-- White for glyph pixels, transparent elsewhere
-- Input: [h*w*4] u8 RGBA, Output: [h*w*4] u8 RGBA mask
entry debug_glyph_mask [n]
    (image_flat: [n]u8)
    (width: i64) (height: i64)
    (max_distance: f32): []u8 =
  let image_2d: [height][width]rgba =
    tabulate_2d height width (\y x ->
      let idx = (y * width + x) * 4
      in {
        r = image_flat[idx],
        g = image_flat[idx + 1],
        b = image_flat[idx + 2],
        a = image_flat[idx + 3]
      }
    )
  let levels = pass_grayscale image_2d
  let cfg = {max_distance, target_contrast = 7f32, sample_distance = 5f32, use_relaxation = false}
  let esdt = pass_esdt levels cfg
  let mask = pass_extract_glyphs esdt cfg
  let result = map (map (\m ->
    if m.is_glyph
    then
      let v = u8.f32 (255f32 * m.coverage)
      in {r = v, g = v, b = v, a = 255u8}
    else {r = 0u8, g = 0u8, b = 0u8, a = 0u8}
  )) mask
  in flatten (map (map (\px -> [px.r, px.g, px.b, px.a])) result) |> flatten

-- Debug visualization: WCAG compliance heatmap
-- Green for passing contrast, red for failing, transparent for non-glyph
-- Input: [h*w*4] u8 RGBA, Output: [h*w*4] u8 RGBA compliance map
entry debug_wcag_compliance [n]
    (image_flat: [n]u8)
    (width: i64) (height: i64)
    (target_contrast: f32)
    (max_distance: f32)
    (sample_distance: f32): []u8 =
  let cfg = {max_distance, target_contrast, sample_distance, use_relaxation = false}
  let image_2d: [height][width]rgba =
    tabulate_2d height width (\y x ->
      let idx = (y * width + x) * 4
      in {
        r = image_flat[idx],
        g = image_flat[idx + 1],
        b = image_flat[idx + 2],
        a = image_flat[idx + 3]
      }
    )
  let levels = pass_grayscale image_2d
  let esdt = pass_esdt levels cfg
  let mask = pass_extract_glyphs esdt cfg
  let backgrounds = pass_sample_background image_2d mask esdt cfg
  let adjustments = pass_adjust_contrast image_2d mask backgrounds cfg
  let result = map2 (\row_mask row_adj ->
    map2 (\m adj ->
      if !m.is_glyph
      then {r = 0u8, g = 0u8, b = 0u8, a = 0u8}
      else if adj.needs_adjustment
      then
        -- Failing: red with intensity based on how far below target
        let ratio = f32.min 1f32 (adj.original_contrast / target_contrast)
        let intensity = u8.f32 (200f32 + 55f32 * (1f32 - ratio))
        in {r = intensity, g = 40u8, b = 40u8, a = 200u8}
      else
        -- Passing: green
        {r = 40u8, g = 200u8, b = 40u8, a = 200u8}
    ) row_mask row_adj
  ) mask adjustments
  in flatten (map (map (\px -> [px.r, px.g, px.b, px.a])) result) |> flatten

-- Tests

-- ==
-- entry: test_pipeline_passthrough
-- input { }
-- output { true }
entry test_pipeline_passthrough: bool =
  -- White text on black background with proper padding
  -- The 5x5 grid ensures background sampling works correctly
  let image: [5][5]rgba = [
    [{r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}],
    [{r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}],
    [{r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=255u8, g=255u8, b=255u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}],
    [{r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}],
    [{r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}, {r=0u8, g=0u8, b=0u8, a=255u8}]
  ]
  -- Use short sample distance for this small test
  let cfg = {max_distance = 2.0f32, target_contrast = 7.0f32, sample_distance = 2.0f32, use_relaxation = false}
  let result = run_pipeline image cfg
  -- Center pixel should remain white (21:1 contrast, no adjustment needed)
  -- Note: With zero gradient at center (solid interior), it may still sample black background
  let center = result[2, 2]
  -- Check that white pixel wasn't darkened (it should stay white or at least bright)
  in center.r >= 200u8 && center.g >= 200u8 && center.b >= 200u8

-- ==
-- entry: test_grayscale
-- input { }
-- output { true }
entry test_grayscale: bool =
  let image: [1][1]rgba = [[{r=255u8, g=255u8, b=255u8, a=255u8}]]
  let levels = pass_grayscale image
  in f32.abs(levels[0, 0] - 1f32) < 0.01f32
