// SPDX-License-Identifier: MIT
// Circular Shadow Visualizer (Rotating) for CAVA (sdl_glsl)
// Same as circle_shadow.frag but with slow rotation and sweep highlight
#version 330
in vec2 fragCoord;
out vec4 fragColor;

uniform float bars[512];
uniform int bars_count;
uniform int bar_width;
uniform int bar_spacing;
uniform vec3 u_resolution;
uniform vec3 bg_color;
uniform vec3 fg_color;
uniform int gradient_count;
uniform vec3 gradient_colors[8];
uniform float shader_time;

// ====== TUNABLE PARAMETERS ======
const float BASE_RADIUS     = 0.30;
const float BAR_MAX_LEN     = 0.18;
const float RING_THICKNESS  = 0.008;
const float INNER_GLOW_R    = 0.025;
const float OUTER_GLOW_W    = 0.045;
const float AMBIENT_GLOW    = 0.06;
const float GLOW_INTENSITY  = 0.55;
const float SHADOW_SOFTNESS = 0.012;
const float BARS_GAP        = 0.25;
const float ROTATE_SPEED    = 0.08;   // Rotation speed (revolutions per second)
const float SWEEP_WIDTH     = 0.12;   // Sweep highlight width
const float SWEEP_INTENSITY = 0.35;   // Sweep brightness boost

vec3 normalize_C(float y, vec3 c1, vec3 c2, float y1, float y2) {
    float t = clamp((y - y1) / max(y2 - y1, 0.0001), 0.0, 1.0);
    return mix(c1, c2, t);
}

float sample_bar(float a) {
    int bc = min(bars_count, 512);
    if (bc <= 0) return 0.0;
    float cell = a * float(bc);
    int i0 = int(floor(cell));
    i0 = clamp(i0, 0, bc - 1);
    int i1 = i0 + 1;
    if (i1 >= bc) i1 = 0;
    float f = fract(cell);
    f = smoothstep(0.0, 1.0, f);
    float v0 = clamp(bars[i0], 0.0, 1.0);
    float v1 = clamp(bars[i1], 0.0, 1.0);
    return mix(v0, v1, f);
}

vec3 get_gradient_color(float amp) {
    if (gradient_count == 0) return fg_color;
    if (gradient_count == 1) return gradient_colors[0];
    int idx = int(floor(float(gradient_count - 1) * amp));
    idx = clamp(idx, 0, gradient_count - 2);
    float y0 = float(idx) / float(gradient_count - 1);
    float y1 = float(idx + 1) / float(gradient_count - 1);
    return normalize_C(amp, gradient_colors[idx], gradient_colors[idx + 1], y0, y1);
}

void main() {
    vec2 p = fragCoord - vec2(0.5);
    p.x *= u_resolution.x / u_resolution.y;

    float r = length(p);
    float theta = atan(p.y, p.x);
    float pi = 3.14159265359;
    float tau = pi * 2.0;

    // Rotation: phase shift bar sampling angle
    float phase = fract(shader_time * ROTATE_SPEED);
    float a = fract((theta + pi) / tau + phase); // Rotated angular position

    // Sweep highlight position
    float sweep_pos = fract(shader_time * 0.15);
    float da = abs(a - sweep_pos);
    da = min(da, 1.0 - da);
    float sweep = smoothstep(SWEEP_WIDTH, 0.0, da) * SWEEP_INTENSITY;

    float px = max(length(dFdx(p)), length(dFdy(p)));
    float t = shader_time;
    float pulse = 1.0 + 0.03 * sin(t * 0.8) * 0.5;
    float base_r = BASE_RADIUS * pulse;

    float amp = sample_bar(a);
    float amp_boost = pow(amp, 0.85) * (1.0 + 0.4 * (1.0 - amp));
    float bar_len = amp_boost * BAR_MAX_LEN;
    float bar_outer = base_r + RING_THICKNESS * 0.5 + bar_len;
    float bar_inner = base_r - RING_THICKNESS * 0.5;

    float fill = 1.0 - BARS_GAP;
    float cell = a * float(min(bars_count, 512));
    float f = fract(cell);
    float ang = abs(f - 0.5);
    float df = 0.5 * (float(min(bars_count, 512)) * px) / (tau * max(r, px));
    float ang_mask = 1.0 - smoothstep(fill * 0.5 - df, fill * 0.5 + df, ang);

    // Base ring
    float ring_inner = base_r - RING_THICKNESS * 0.5;
    float ring_outer = base_r + RING_THICKNESS * 0.5;
    float ring_dr = clamp(px, 0.001, 0.003);
    float ring_alpha = smoothstep(ring_inner - ring_dr, ring_inner + ring_dr, r) *
                       (1.0 - smoothstep(ring_outer - ring_dr, ring_outer + ring_dr, r));
    float avg_amp = amp * 0.5 + 0.3;
    vec3 ring_col = get_gradient_color(0.3) * avg_amp;
    ring_alpha *= 0.7 + 0.3 * amp;

    // Bars
    float bar_dr = max(SHADOW_SOFTNESS, px * 1.5);
    float bar_inner_mask = smoothstep(bar_inner - bar_dr, bar_inner + bar_dr, r);
    float bar_outer_mask = 1.0 - smoothstep(bar_outer - bar_dr, bar_outer + bar_dr, r);
    float bar_alpha = bar_inner_mask * bar_outer_mask * ang_mask;
    bar_alpha *= smoothstep(0.0, 0.02, amp);
    vec3 bar_col = get_gradient_color(amp_boost);
    float tip_fade = smoothstep(bar_outer - bar_dr * 3.0, bar_outer, r);
    bar_col = mix(bar_col, vec3(1.0), tip_fade * 0.4 * amp);
    bar_col = min(bar_col * (1.0 + sweep), vec3(1.0));

    // Outer glow
    float glow_outer = bar_outer + OUTER_GLOW_W * amp_boost;
    float glow_dist = (r - bar_outer) / max(OUTER_GLOW_W * amp_boost + px, 0.001);
    float glow_alpha = 0.0;
    if (r > bar_outer && r < glow_outer && ang_mask > 0.01) {
        float gd = smoothstep(1.0, 0.0, glow_dist);
        glow_alpha = gd * gd * ang_mask * GLOW_INTENSITY * amp;
    }
    float ambient_outer = base_r + BAR_MAX_LEN + AMBIENT_GLOW;
    float ambient_dist = (r - bar_outer) / max(AMBIENT_GLOW + px, 0.001);
    float ambient_alpha = 0.0;
    if (r > bar_outer && r < ambient_outer) {
        float ad = smoothstep(1.0, 0.0, ambient_dist);
        ambient_alpha = ad * ad * ad * 0.15 * amp;
    }
    vec3 glow_col = get_gradient_color(amp_boost * 0.8);

    // Inner glow
    float inner_glow_dist = (ring_inner - r) / max(INNER_GLOW_R + px, 0.001);
    float inner_glow_alpha = 0.0;
    if (r < ring_inner && r > ring_inner - INNER_GLOW_R) {
        float igd = smoothstep(1.0, 0.0, inner_glow_dist);
        inner_glow_alpha = igd * igd * 0.25 * (0.5 + 0.5 * avg_amp);
    }
    vec3 inner_glow_col = get_gradient_color(0.2);

    // Center fill
    float center_dist = r / base_r;
    float center_alpha = 0.0;
    if (r < base_r - RING_THICKNESS * 0.5 - INNER_GLOW_R * 0.5) {
        float cd = 1.0 - smoothstep(0.0, 0.7, center_dist);
        center_alpha = cd * 0.04 * avg_amp;
    }
    vec3 center_col = get_gradient_color(0.1);

    // Composite
    vec3 final_col = bg_color;
    final_col = mix(final_col, glow_col, ambient_alpha);
    final_col = mix(final_col, glow_col, glow_alpha * 0.7);
    final_col = mix(final_col, inner_glow_col, inner_glow_alpha);
    final_col = mix(final_col, center_col, center_alpha);
    final_col = mix(final_col, ring_col, ring_alpha);
    final_col = mix(final_col, bar_col, bar_alpha);

    float tip_bloom = 0.0;
    if (r > bar_outer - bar_dr * 2.0 && r < bar_outer + bar_dr * 2.0) {
        float td = 1.0 - abs(r - bar_outer) / (bar_dr * 2.0);
        tip_bloom = td * td * ang_mask * amp * 0.5;
    }
    final_col += vec3(1.0) * tip_bloom;

    // Add sweep light to glow layers
    final_col += get_gradient_color(0.6) * sweep * 0.15;

    fragColor = vec4(final_col, 1.0);
}
