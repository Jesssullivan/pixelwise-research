-- Exact Signed Distance Transform (ESDT) Implementation
--
-- Port of the Rust CPU reference implementation to Futhark.
-- ESDT extends classical EDT to handle anti-aliased (gray) pixels.
--
-- Algorithm:
-- 1. Initialize: gray pixels get sub-pixel offsets based on gradient
-- 2. X-pass: horizontal distance propagation (forward + backward)
-- 3. Y-pass: vertical distance propagation (forward + backward)
-- 4. Optional relaxation: fix diagonal ordering bias
--
-- Data representation:
--   - Levels: 2D array of f32 [0,1] where 0=background, 1=foreground
--   - ESDT result: 2D array of (delta_x, delta_y) offset vectors

type esdt_pixel = {delta_x: f32, delta_y: f32}

-- Sentinel for infinite distance (no nearby edge)
def esdt_inf: esdt_pixel = {delta_x = 1e10f32, delta_y = 1e10f32}

-- Zero offset (pixel is on/inside glyph)
def esdt_zero: esdt_pixel = {delta_x = 0f32, delta_y = 0f32}

-- Squared Euclidean distance (avoids sqrt for comparisons)
def squared_distance (p: esdt_pixel): f32 =
  p.delta_x * p.delta_x + p.delta_y * p.delta_y

-- Euclidean distance to nearest edge
def distance (p: esdt_pixel): f32 =
  f32.sqrt (squared_distance p)

-- Normalized gradient direction (unit vector toward edge)
def gradient (p: esdt_pixel): (f32, f32) =
  let d = distance p
  in if d > 0.001f32
     then (p.delta_x / d, p.delta_y / d)
     else (0f32, 0f32)

-- Check if pixel has infinite distance
def is_infinite (p: esdt_pixel): bool =
  f32.abs p.delta_x > 1e9f32 || f32.abs p.delta_y > 1e9f32

-- Compute gradient at (x,y) using 3x3 Sobel-like operator
-- Uses [1, 2, 1] weighted kernel for noise reduction
def compute_gradient [h][w] (levels: [h][w]f32) (y: i64) (x: i64): (f32, f32) =
  let weights: [3]f32 = [1f32, 2f32, 1f32]
  let (grad_x, grad_y) =
    loop (gx, gy) = (0f32, 0f32) for dy in 0..<3 do
      loop (gx', gy') = (gx, gy) for dx in 0..<3 do
        let px = i64.max 0 (i64.min (w - 1) (x + dx - 1))
        let py = i64.max 0 (i64.min (h - 1) (y + dy - 1))
        let sample = levels[py, px]
        let wt = weights[dy] * weights[dx]
        let gx'' = gx' + (f32.i64 dx - 1f32) * sample * wt
        let gy'' = gy' + (f32.i64 dy - 1f32) * sample * wt
        in (gx'', gy'')
  let len = f32.sqrt (grad_x * grad_x + grad_y * grad_y)
  in if len > 0.001f32
     then (grad_x / len, grad_y / len)
     else (0f32, 0f32)

-- Initialize ESDT from anti-aliased grayscale image
-- Gray pixels (0 < L < 1) get sub-pixel offsets in gradient direction
def esdt_initialize [h][w] (levels: [h][w]f32): [h][w]esdt_pixel =
  map2 (\y row ->
    map2 (\x level ->
      if level <= 0f32 then
        -- Background: infinite distance
        esdt_inf
      else if level >= 1f32 then
        -- Foreground: inside glyph, zero distance
        esdt_zero
      else
        -- Gray (edge) pixel: sub-pixel offset in gradient direction
        let (gx, gy) = compute_gradient levels y x
        let offset = level - 0.5f32
        in {delta_x = offset * gx, delta_y = offset * gy}
    ) (iota w) row
  ) (iota h) levels

-- Single row X-pass: propagate left-to-right, then right-to-left
def esdt_x_pass_row [w] (row: [w]esdt_pixel): [w]esdt_pixel =
  -- Forward pass (left to right)
  let row' = loop row = copy row for x in 1..<w do
    let prev = row[x-1]
    let candidate = {delta_x = prev.delta_x + 1f32, delta_y = prev.delta_y}
    let current = row[x]
    in if squared_distance candidate < squared_distance current
       then row with [x] = candidate
       else row
  -- Backward pass (right to left)
  let row'' = loop row = row' for x_rev in 1..<w do
    let x = w - 1 - x_rev
    let next = row[x + 1]
    let candidate = {delta_x = next.delta_x - 1f32, delta_y = next.delta_y}
    let current = row[x]
    in if squared_distance candidate < squared_distance current
       then row with [x] = candidate
       else row
  in row''

-- X-pass: horizontal propagation for all rows
def esdt_x_pass [h][w] (pixels: [h][w]esdt_pixel): [h][w]esdt_pixel =
  map esdt_x_pass_row pixels

-- Single column Y-pass: propagate top-to-bottom, then bottom-to-top
-- Uses column as 1D array for efficiency
def esdt_y_pass_col [h] (col: [h]esdt_pixel): [h]esdt_pixel =
  -- Forward pass (top to bottom)
  let col' = loop col = copy col for y in 1..<h do
    let prev = col[y-1]
    let candidate = {delta_x = prev.delta_x, delta_y = prev.delta_y + 1f32}
    let current = col[y]
    in if squared_distance candidate < squared_distance current
       then col with [y] = candidate
       else col
  -- Backward pass (bottom to top)
  let col'' = loop col = col' for y_rev in 1..<h do
    let y = h - 1 - y_rev
    let next = col[y + 1]
    let candidate = {delta_x = next.delta_x, delta_y = next.delta_y - 1f32}
    let current = col[y]
    in if squared_distance candidate < squared_distance current
       then col with [y] = candidate
       else col
  in col''

-- Y-pass: vertical propagation for all columns
def esdt_y_pass [h][w] (pixels: [h][w]esdt_pixel): [h][w]esdt_pixel =
  transpose (map esdt_y_pass_col (transpose pixels))

-- Single relaxation iteration: check 4-connected neighbors
def esdt_relax_iteration [h][w] (pixels: [h][w]esdt_pixel): ([h][w]esdt_pixel, bool) =
  let (new_pixels, changes) =
    unzip (
      map2 (\y row ->
        unzip (
          map2 (\x current ->
            let current_d2 = squared_distance current
            -- Check left neighbor
            let (p1, c1) =
              if x > 0 then
                let neighbor = pixels[y, x-1]
                let cand = {delta_x = neighbor.delta_x + 1f32, delta_y = neighbor.delta_y}
                in if squared_distance cand < current_d2 - 0.0001f32
                   then (cand, true)
                   else (current, false)
              else (current, false)
            -- Check right neighbor
            let (p2, c2) =
              if x < w - 1 then
                let neighbor = pixels[y, x+1]
                let cand = {delta_x = neighbor.delta_x - 1f32, delta_y = neighbor.delta_y}
                let current' = if c1 then p1 else current
                in if squared_distance cand < squared_distance current' - 0.0001f32
                   then (cand, true)
                   else (current', false)
              else (p1, c1)
            -- Check top neighbor
            let (p3, c3) =
              if y > 0 then
                let neighbor = pixels[y-1, x]
                let cand = {delta_x = neighbor.delta_x, delta_y = neighbor.delta_y + 1f32}
                let current' = if c2 then p2 else p1
                in if squared_distance cand < squared_distance current' - 0.0001f32
                   then (cand, true)
                   else (current', false)
              else (p2, c2)
            -- Check bottom neighbor
            let (p4, c4) =
              if y < h - 1 then
                let neighbor = pixels[y+1, x]
                let cand = {delta_x = neighbor.delta_x, delta_y = neighbor.delta_y - 1f32}
                let current' = if c3 then p3 else p2
                in if squared_distance cand < squared_distance current' - 0.0001f32
                   then (cand, true)
                   else (current', false)
              else (p3, c3)
            in (p4, c1 || c2 || c3 || c4)
          ) (iota w) row
        )
      ) (iota h) pixels
    )
  let any_changed = flatten changes |> reduce (||) false
  in (new_pixels, any_changed)

-- Relaxation pass: iteratively fix diagonal ordering bias
def esdt_relaxation_pass [h][w] (pixels: [h][w]esdt_pixel): [h][w]esdt_pixel =
  let max_iterations = 4i64
  let (final_pixels, _) =
    loop (pix, iter) = (pixels, 0i64) while iter < max_iterations do
      let (pix', changed) = esdt_relax_iteration pix
      in if changed then (pix', iter + 1) else (pix', max_iterations)
  in final_pixels

-- Complete ESDT computation
-- Returns 2D array of (delta_x, delta_y) offset vectors
def compute_esdt [h][w] (levels: [h][w]f32) (use_relaxation: bool): [h][w]esdt_pixel =
  let pixels = esdt_initialize levels
  let pixels' = esdt_x_pass pixels
  let pixels'' = esdt_y_pass pixels'
  in if use_relaxation
     then esdt_relaxation_pass pixels''
     else pixels''

-- Glyph pixel data extracted from ESDT
type glyph_pixel = {
  x: i32,
  y: i32,
  coverage: f32,
  edge_weight: f32,
  grad_x: f32,
  grad_y: f32
}

-- Create glyph pixel from ESDT data
def glyph_pixel_from_esdt (x: i32) (y: i32) (esdt: esdt_pixel) (max_distance: f32): glyph_pixel =
  let d = distance esdt
  let (gx, gy) = gradient esdt
  -- Coverage: 1.0 at center, 0.0 at max_distance
  let coverage = f32.max 0f32 (f32.min 1f32 (1f32 - d / max_distance))
  -- Edge weight: 4*alpha*(1-alpha), peaks at alpha=0.5
  -- This is the "inverse kernel density" concept from the architecture
  let edge_weight = 4f32 * coverage * (1f32 - coverage)
  in {x, y, coverage, edge_weight, grad_x = gx, grad_y = gy}

-- Extract glyph pixels within max_distance of edges
-- Returns array of glyph pixels with valid flag for filtering
type maybe_glyph = {valid: bool, glyph: glyph_pixel}

def extract_glyph_pixels_dense [h][w] (esdt: [h][w]esdt_pixel) (max_distance: f32): [h][w]maybe_glyph =
  map2 (\y row ->
    map2 (\x pixel ->
      let d = distance pixel
      let glyph = glyph_pixel_from_esdt (i32.i64 x) (i32.i64 y) pixel max_distance
      let valid = d < max_distance && glyph.coverage > 0.02f32
      in {valid, glyph}
    ) (iota w) row
  ) (iota h) esdt

-- Filter to only valid glyph pixels (sparse)
def extract_glyph_pixels [h][w] (esdt: [h][w]esdt_pixel) (max_distance: f32): []glyph_pixel =
  let dense = extract_glyph_pixels_dense esdt max_distance
  let flat = flatten dense
  in filter (\mg -> mg.valid) flat |> map (\mg -> mg.glyph)

-- Entry point: compute ESDT from 2D array
-- Input: [h][w]f32 grayscale levels
-- Output: [h*w*2]f32 as [delta_x, delta_y, delta_x, delta_y, ...]
entry compute_esdt_2d [h][w] (levels: [h][w]f32) (use_relaxation: bool): []f32 =
  let esdt = compute_esdt levels use_relaxation
  in flatten (map (\row -> flatten (map (\p -> [p.delta_x, p.delta_y]) row)) esdt)

-- Entry point: get distance at specific pixel from flat ESDT data
entry get_distance_at [n] (esdt_flat: [n]f32) (width: i64) (x: i64) (y: i64): f32 =
  let idx = (y * width + x) * 2
  in if idx + 1 < n
     then let dx = esdt_flat[idx]
          let dy = esdt_flat[idx + 1]
          in f32.sqrt (dx * dx + dy * dy)
     else f32.inf

-- Test: single white pixel in center of 3x3
-- ==
-- entry: test_single_point
-- input { }
-- output { true }
entry test_single_point: bool =
  let levels = [[0f32, 0f32, 0f32],
                [0f32, 1f32, 0f32],
                [0f32, 0f32, 0f32]]
  let esdt = compute_esdt levels false
  -- Center should have zero distance
  let center_d = distance esdt[1, 1]
  -- Corners should have distance ~sqrt(2) = 1.414
  let corner_d = distance esdt[0, 0]
  in center_d < 0.01f32 && f32.abs(corner_d - 1.414f32) < 0.15f32

-- Test: horizontal line
-- ==
-- entry: test_horizontal_line
-- input { }
-- output { true }
entry test_horizontal_line: bool =
  let levels = [[0f32, 0f32, 0f32, 0f32, 0f32],
                [0f32, 0f32, 0f32, 0f32, 0f32],
                [1f32, 1f32, 1f32, 1f32, 1f32],
                [0f32, 0f32, 0f32, 0f32, 0f32],
                [0f32, 0f32, 0f32, 0f32, 0f32]]
  let esdt = compute_esdt levels false
  -- Line pixels should have zero distance
  let line_ok = all (\x -> distance esdt[2, x] < 0.01f32) (iota 5)
  -- Adjacent rows should have distance ~1
  let above_ok = all (\x -> f32.abs(distance esdt[1, x] - 1f32) < 0.15f32) (iota 5)
  let below_ok = all (\x -> f32.abs(distance esdt[3, x] - 1f32) < 0.15f32) (iota 5)
  in line_ok && above_ok && below_ok

-- Test: edge weight peaks at coverage=0.5
-- ==
-- entry: test_edge_weight
-- input { }
-- output { true }
entry test_edge_weight: bool =
  let esdt_pixel = {delta_x = 0.5f32, delta_y = 0f32}  -- distance = 0.5
  let glyph = glyph_pixel_from_esdt 0 0 esdt_pixel 1f32
  -- coverage = 1 - 0.5/1.0 = 0.5
  -- edge_weight = 4 * 0.5 * 0.5 = 1.0
  in f32.abs(glyph.coverage - 0.5f32) < 0.01f32 &&
     f32.abs(glyph.edge_weight - 1f32) < 0.01f32
