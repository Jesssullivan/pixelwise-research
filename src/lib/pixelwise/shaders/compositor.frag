#version 300 es
precision highp float;

// Inputs
in vec2 vUV;

// Textures
uniform sampler2D uBackground;      // Captured background
uniform sampler2D uTextMask;        // Alpha mask: where text pixels are
uniform sampler2D uTextColor;       // Original text colors

// Uniforms
uniform vec2 uResolution;
uniform float uTargetContrast;      // 4.5 (AA) or 7.0 (AAA)

// Output
out vec4 fragColor;

// Gaussian 5x5 kernel weights (sum = 256)
const float kernel[25] = float[](
    1.0, 4.0, 6.0, 4.0, 1.0,
    4.0, 16.0, 24.0, 16.0, 4.0,
    6.0, 24.0, 36.0, 24.0, 6.0,
    4.0, 16.0, 24.0, 16.0, 4.0,
    1.0, 4.0, 6.0, 4.0, 1.0
);

// Sample background with 5x5 Gaussian blur
vec3 gaussianSample(sampler2D tex, vec2 uv) {
    vec3 color = vec3(0.0);
    vec2 texelSize = 1.0 / uResolution;

    int idx = 0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            color += texture(tex, uv + offset).rgb * kernel[idx];
            idx++;
        }
    }
    return color / 256.0;
}

// Convert sRGB to linear (gamma decode)
// WCAG 2.1 spec: threshold at 0.03928
vec3 srgbToLinear(vec3 srgb) {
    vec3 low = srgb / 12.92;
    vec3 high = pow((srgb + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.03928), srgb));
}

// Calculate relative luminance per WCAG 2.1
float relativeLuminance(vec3 color) {
    vec3 linear = srgbToLinear(color);
    return dot(linear, vec3(0.2126, 0.7152, 0.0722));
}

// Calculate contrast ratio
float contrastRatio(float l1, float l2) {
    float lighter = max(l1, l2);
    float darker = min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

// Find WCAG-compliant color by adjusting luminance
vec3 adjustForContrast(vec3 textColor, vec3 bgColor, float target) {
    float bgLum = relativeLuminance(bgColor);
    float textLum = relativeLuminance(textColor);
    float currentContrast = contrastRatio(textLum, bgLum);

    // Already compliant
    if (currentContrast >= target) {
        return textColor;
    }

    // Determine direction: lighten or darken text
    bool shouldLighten = bgLum < 0.5;

    // Calculate required luminance
    float targetLum;
    if (shouldLighten) {
        // Text needs to be lighter: L_text = CR * (L_bg + 0.05) - 0.05
        targetLum = target * (bgLum + 0.05) - 0.05;
    } else {
        // Text needs to be darker: L_text = (L_bg + 0.05) / CR - 0.05
        targetLum = (bgLum + 0.05) / target - 0.05;
    }

    // Clamp to valid range
    targetLum = clamp(targetLum, 0.0, 1.0);

    // Scale text color to achieve target luminance while preserving hue
    float scale = targetLum / max(textLum, 0.001);
    vec3 adjusted = clamp(textColor * scale, 0.0, 1.0);

    return adjusted;
}

void main() {
    // Check if this pixel is text (alpha from text mask)
    float textAlpha = texture(uTextMask, vUV).a;

    // Not a text pixel - fully transparent (pass-through)
    if (textAlpha < 0.01) {
        fragColor = vec4(0.0);
        return;
    }

    // This is a text pixel - apply compositor
    // 1. Sample background with Gaussian blur
    vec3 bgColor = gaussianSample(uBackground, vUV);

    // 2. Get original text color
    vec3 textColor = texture(uTextColor, vUV).rgb;

    // 3. Calculate WCAG-compliant adjusted color
    vec3 adjustedColor = adjustForContrast(textColor, bgColor, uTargetContrast);

    // 4. Output adjusted color with text alpha
    // This composites OVER the original text, replacing its color visually
    fragColor = vec4(adjustedColor, textAlpha);
}
