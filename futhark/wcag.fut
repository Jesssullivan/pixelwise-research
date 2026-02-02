-- WCAG 2.1 Contrast Calculation Module
--
-- Implements:
-- - Relative luminance with gamma correction
-- - Contrast ratio calculation (1.0 to 21.0)
-- - AA/AAA compliance checking
-- - Color adjustment for compliance
--
-- Reference: https://www.w3.org/WAI/WCAG21/Techniques/general/G17

-- sRGB gamma correction per WCAG 2.1 spec
-- If value <= 0.03928: value / 12.92
-- If value >  0.03928: ((value + 0.055) / 1.055) ^ 2.4
-- Power function using exp(b * ln(a))
def pow (base: f32) (exp: f32): f32 =
  if base <= 0f32
  then 0f32
  else f32.exp (exp * f32.log base)

-- sRGB gamma correction per WCAG 2.1 spec
-- If value <= 0.03928: value / 12.92
-- If value >  0.03928: ((value + 0.055) / 1.055) ^ 2.4
def to_linear (rgb: f32): f32 =
  if rgb <= 0.03928f32
  then rgb / 12.92f32
  else pow ((rgb + 0.055f32) / 1.055f32) 2.4f32

-- Convert 8-bit RGB to linear
def to_linear_u8 (rgb: u8): f32 =
  to_linear (f32.u8 rgb / 255f32)

-- Relative luminance per WCAG 2.1
-- L = 0.2126 * R + 0.7152 * G + 0.0722 * B
def relative_luminance (r: f32) (g: f32) (b: f32): f32 =
  0.2126f32 * to_linear r +
  0.7152f32 * to_linear g +
  0.0722f32 * to_linear b

-- Relative luminance from 8-bit RGB
def relative_luminance_u8 (r: u8) (g: u8) (b: u8): f32 =
  relative_luminance (f32.u8 r / 255f32) (f32.u8 g / 255f32) (f32.u8 b / 255f32)

-- Contrast ratio per WCAG 2.1
-- CR = (L1 + 0.05) / (L2 + 0.05) where L1 >= L2
def contrast_ratio (l1: f32) (l2: f32): f32 =
  let lighter = f32.max l1 l2
  let darker = f32.min l1 l2
  in (lighter + 0.05f32) / (darker + 0.05f32)

-- Contrast ratio from 8-bit RGB colors
def contrast_ratio_rgb (r1: u8) (g1: u8) (b1: u8) (r2: u8) (g2: u8) (b2: u8): f32 =
  let l1 = relative_luminance_u8 r1 g1 b1
  let l2 = relative_luminance_u8 r2 g2 b2
  in contrast_ratio l1 l2

-- WCAG AA compliance thresholds
-- Normal text: 4.5:1
-- Large text (18pt+ or 14pt+ bold): 3.0:1
def is_aa_compliant (cr: f32) (is_large_text: bool): bool =
  if is_large_text
  then cr >= 3.0f32
  else cr >= 4.5f32

-- WCAG AAA compliance thresholds
-- Normal text: 7.0:1
-- Large text: 4.5:1
def is_aaa_compliant (cr: f32) (is_large_text: bool): bool =
  if is_large_text
  then cr >= 4.5f32
  else cr >= 7.0f32

-- Find target luminance for compliance
-- Given background luminance and target contrast ratio,
-- compute required text luminance
def target_luminance_for_contrast (bg_lum: f32) (target_cr: f32) (prefer_lighter: bool): f32 =
  if prefer_lighter
  then
    -- L_text = CR * (L_bg + 0.05) - 0.05
    f32.max 0f32 (f32.min 1f32 (target_cr * (bg_lum + 0.05f32) - 0.05f32))
  else
    -- L_text = (L_bg + 0.05) / CR - 0.05
    f32.max 0f32 (f32.min 1f32 ((bg_lum + 0.05f32) / target_cr - 0.05f32))

-- Adjust color to meet target luminance (preserving hue)
-- Returns adjusted RGB as f32 in [0, 1]
def adjust_color_luminance (r: f32) (g: f32) (b: f32) (target_lum: f32): (f32, f32, f32) =
  let current_lum = relative_luminance r g b
  in if current_lum < 0.001f32
     then
       -- Near-black: make gray with target luminance
       let gray = f32.sqrt (target_lum / 0.2126f32)  -- Approximate
       in (gray, gray, gray)
     else
       let ratio = target_lum / current_lum
       let r' = f32.min 1f32 (f32.max 0f32 (r * ratio))
       let g' = f32.min 1f32 (f32.max 0f32 (g * ratio))
       let b' = f32.min 1f32 (f32.max 0f32 (b * ratio))
       in (r', g', b')

-- Find compliant color adjustment
-- Adjusts text color to meet target contrast against background
def find_compliant_color
    (text_r: u8) (text_g: u8) (text_b: u8)
    (bg_r: u8) (bg_g: u8) (bg_b: u8)
    (target_cr: f32): (u8, u8, u8) =
  let text_lum = relative_luminance_u8 text_r text_g text_b
  let bg_lum = relative_luminance_u8 bg_r bg_g bg_b
  let current_cr = contrast_ratio text_lum bg_lum
  in if current_cr >= target_cr
     then (text_r, text_g, text_b)  -- Already compliant
     else
       -- Determine if text should be lighter or darker
       let text_is_lighter = text_lum > bg_lum
       let target_lum = target_luminance_for_contrast bg_lum target_cr text_is_lighter
       let (r', g', b') = adjust_color_luminance
         (f32.u8 text_r / 255f32)
         (f32.u8 text_g / 255f32)
         (f32.u8 text_b / 255f32)
         target_lum
       in (u8.f32 (r' * 255f32), u8.f32 (g' * 255f32), u8.f32 (b' * 255f32))

-- Batch process: compute luminance for array of RGB pixels
-- Input: flat array [r, g, b, r, g, b, ...]
-- Output: array of luminance values
def batch_luminance [n] (rgb: [n]u8): []f32 =
  let pixels = n / 3
  in tabulate pixels (\i ->
    relative_luminance_u8 rgb[i*3] rgb[i*3+1] rgb[i*3+2]
  )

-- Batch process: compute contrast ratios for text/bg pairs
-- Input: text_rgb [n*3], bg_rgb [n*3]
-- Output: contrast ratios [n]
def batch_contrast [n] (text_rgb: [n]u8) (bg_rgb: [n]u8): []f32 =
  let pixels = n / 3
  in tabulate pixels (\i ->
    contrast_ratio_rgb
      text_rgb[i*3] text_rgb[i*3+1] text_rgb[i*3+2]
      bg_rgb[i*3] bg_rgb[i*3+1] bg_rgb[i*3+2]
  )

-- Entry points for WASM

entry luminance_rgb (r: u8) (g: u8) (b: u8): f32 =
  relative_luminance_u8 r g b

entry contrast_rgb (r1: u8) (g1: u8) (b1: u8) (r2: u8) (g2: u8) (b2: u8): f32 =
  contrast_ratio_rgb r1 g1 b1 r2 g2 b2

entry check_aa (cr: f32) (is_large: bool): bool =
  is_aa_compliant cr is_large

entry check_aaa (cr: f32) (is_large: bool): bool =
  is_aaa_compliant cr is_large

entry adjust_for_compliance
    (text_r: u8) (text_g: u8) (text_b: u8)
    (bg_r: u8) (bg_g: u8) (bg_b: u8)
    (target_cr: f32): [3]u8 =
  let (r, g, b) = find_compliant_color text_r text_g text_b bg_r bg_g bg_b target_cr
  in [r, g, b]

-- Tests

-- ==
-- entry: test_white_black_contrast
-- input { }
-- output { true }
entry test_white_black_contrast: bool =
  let l_white = relative_luminance_u8 255 255 255
  let l_black = relative_luminance_u8 0 0 0
  let cr = contrast_ratio l_white l_black
  in f32.abs(l_white - 1f32) < 0.01f32 &&
     l_black < 0.01f32 &&
     f32.abs(cr - 21f32) < 0.1f32

-- ==
-- entry: test_aa_compliance
-- input { }
-- output { true }
entry test_aa_compliance: bool =
  is_aa_compliant 4.5f32 false &&
  is_aa_compliant 3.0f32 true &&
  !is_aa_compliant 4.4f32 false

-- ==
-- entry: test_aaa_compliance
-- input { }
-- output { true }
entry test_aaa_compliance: bool =
  is_aaa_compliant 7.0f32 false &&
  is_aaa_compliant 4.5f32 true &&
  !is_aaa_compliant 6.9f32 false

-- ==
-- entry: test_find_compliant
-- input { }
-- output { true }
entry test_find_compliant: bool =
  -- Gray text on black background
  let (r, g, b) = find_compliant_color 128 128 128 0 0 0 4.5f32
  let cr = contrast_ratio_rgb r g b 0 0 0
  in cr >= 4.5f32
