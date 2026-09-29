// SPDX-License-Identifier: MIT
// Circular Shadow Visualizer for CAVA (sdl_glsl)
// Features: outer glow shadow, inner depth shadow, ambient ring glow, gradient bars
// Based on orion_circle.frag by rezky_nightky
#version 330
in vec2 fragCoord;
out vec4 fragColor;

// CAVA uniforms
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

// ====== 可调参数（TUNABLE PARAMETERS）======
// 注意：修改后需将此文件复制到 ~/.config/cava/shaders/ 并重启 cava
const float BASE_RADIUS = 0.003; // 基环半径（0.0~1.0，占窗口半宽的比例），越大整个圆环越大
const float BAR_MAX_LEN = 0.23; // 【柱条最大长度】柱条从基环向外延伸的最大长度（0.05=很短，0.25=很长）
const float RING_THICKNESS = 0.001; // 基环厚度 0.008
const float INNER_GLOW_R = 0.025; // 内发光宽度（向圆心方向的辉光）
const float OUTER_GLOW_W = 0.045; // 外发光宽度（柱条尖端外的柔和阴影）
const float AMBIENT_GLOW = 0.25; // 环境光晕宽度（整个圆环外的漫射光）0.6;0.09
const float GLOW_INTENSITY = 1; // 发光强度（0=无辉光，1=最强辉光）0.25;0.89;0.65;
const float SHADOW_SOFTNESS = 0.012; // 柱条边缘柔和度 0.012
const float BARS_GAP = 0.8; // 柱条间隙比例（0=无间隙紧密排列，0.5=柱条和间隙各占一半）
const float PULSE_SPEED = 0.8; // 呼吸脉冲速度
const float PULSE_AMP = 0.5; // 呼吸脉冲幅度（0=关闭呼吸效果）

// ====== Color helpers ======
vec3 normalize_C(float y, vec3 c1, vec3 c2, float y1, float y2)
{
    float t = clamp((y - y1) / max(y2 - y1, 0.0001), 0.0, 1.0);
    return mix(c1, c2, t);
}

// Sample bar amplitude at angular position a (0..1), with smoothing
float sample_bar(float a)
{
    int bc = min(bars_count, 512);
    if (bc <= 0)
        return 0.0;
    float cell = a * float(bc);
    int i0 = int(floor(cell));
    i0 = clamp(i0, 0, bc - 1);
    int i1 = i0 + 1;
    if (i1 >= bc)
        i1 = 0;
    float f = fract(cell);
    // Smooth interpolation between adjacent bars
    f = smoothstep(0.0, 1.0, f);
    float v0 = clamp(bars[i0], 0.0, 1.0);
    float v1 = clamp(bars[i1], 0.0, 1.0);
    return mix(v0, v1, f);
}

// Get gradient color for amplitude
vec3 get_gradient_color(float amp)
{
    if (gradient_count == 0)
        return fg_color;
    if (gradient_count == 1)
        return gradient_colors[0];
    int idx = int(floor(float(gradient_count - 1) * amp));
    idx = clamp(idx, 0, gradient_count - 2);
    float y0 = float(idx) / float(gradient_count - 1);
    float y1 = float(idx + 1) / float(gradient_count - 1);
    return normalize_C(amp, gradient_colors[idx], gradient_colors[idx + 1], y0, y1);
}

void main()
{
    vec2 p = fragCoord - vec2(0.5);
    p.x *= u_resolution.x / u_resolution.y; // Correct aspect ratio

    float r = length(p);
    float theta = atan(p.y, p.x);
    float pi = 3.14159265359;
    float tau = pi * 2.0;
    float a = fract((theta + pi) / tau); // Angular position 0..1

    float px = max(length(dFdx(p)), length(dFdy(p))); // Pixel size in NDC
    float t = shader_time;

    // Subtle breathing/pulse
    float pulse = 1.0 + PULSE_AMP * sin(t * PULSE_SPEED) * 0.5;
    float base_r = BASE_RADIUS * pulse;

    // ====== 1. Compute bar geometry for this angle ======
    float amp = sample_bar(a);
    // Nonlinear response: emphasize peaks, add subtle sustain
    float amp_boost = pow(amp, 0.85) * (1.0 + 0.4 * (1.0 - amp));
    float bar_len = amp_boost * BAR_MAX_LEN;
    float bar_outer = base_r + RING_THICKNESS * 0.5 + bar_len;
    float bar_inner = base_r - RING_THICKNESS * 0.5;

    // Angular gap between bars
    float fill = 1.0 - BARS_GAP;
    float cell = a * float(min(bars_count, 512));
    float f = fract(cell);
    float ang = abs(f - 0.5);
    float df = 0.5 * (float(min(bars_count, 512)) * px) / (tau * max(r, px));
    float ang_mask = 1.0 - smoothstep(fill * 0.5 - df, fill * 0.5 + df, ang);

    // ====== 2. Base ring (inner circle) ======
    float ring_inner = base_r - RING_THICKNESS * 0.5;
    float ring_outer = base_r + RING_THICKNESS * 0.5;
    float ring_dr = clamp(px, 0.001, 0.003);
    float ring_alpha = smoothstep(ring_inner - ring_dr, ring_inner + ring_dr, r) * (1.0 - smoothstep(ring_outer - 
ring_dr, ring_outer + ring_dr, r));
    // Ring gets brighter with average amplitude
    float avg_amp = amp * 0.5 + 0.3;
    vec3 ring_col = get_gradient_color(0.3) * avg_amp;
    ring_alpha *= 0.7 + 0.3 * amp;

    // ====== 3. Bars ======
    float bar_dr = max(SHADOW_SOFTNESS, px * 1.5);
    float bar_inner_mask = smoothstep(bar_inner - bar_dr, bar_inner + bar_dr, r);
    float bar_outer_mask = 1.0 - smoothstep(bar_outer - bar_dr, bar_outer + bar_dr, r);
    float bar_alpha = bar_inner_mask * bar_outer_mask * ang_mask;
    bar_alpha *= smoothstep(0.0, 0.02, amp); // Fade out when silent
    vec3 bar_col = get_gradient_color(amp_boost);
    // Add tip highlight
    float tip_fade = smoothstep(bar_outer - bar_dr * 3.0, bar_outer, r);
    bar_col = mix(bar_col, vec3(1.0), tip_fade * 0.4 * amp);

    // ====== 4. Outer glow shadow (extends beyond bar tips) ======
    float glow_outer = bar_outer + OUTER_GLOW_W * amp_boost;
    float glow_dist = (r - bar_outer) / max(OUTER_GLOW_W * amp_boost + px, 0.001);
    float glow_alpha = 0.0;
    if (r > bar_outer && r < glow_outer && ang_mask > 0.01) {
        float gd = smoothstep(1.0, 0.0, glow_dist);
        glow_alpha = gd * gd * ang_mask * GLOW_INTENSITY * amp;
    }
    // Wider, softer ambient glow
    float ambient_outer = base_r + BAR_MAX_LEN + AMBIENT_GLOW;
    float ambient_dist = (r - (bar_outer)) / max(AMBIENT_GLOW + px, 0.001);
    float ambient_alpha = 0.0;
    if (r > bar_outer && r < ambient_outer) {
        float ad = smoothstep(1.0, 0.0, ambient_dist);
        ambient_alpha = ad * ad * ad * 0.15 * amp;
    }
    vec3 glow_col = get_gradient_color(amp_boost * 0.8);

    // ====== 5. Inner glow (light spilling inside the ring) ======
    float inner_glow_dist = (ring_inner - r) / max(INNER_GLOW_R + px, 0.001);
    float inner_glow_alpha = 0.0;
    if (r < ring_inner && r > ring_inner - INNER_GLOW_R) {
        float igd = smoothstep(1.0, 0.0, inner_glow_dist);
        inner_glow_alpha = igd * igd * 0.25 * (0.5 + 0.5 * avg_amp);
    }
    vec3 inner_glow_col = get_gradient_color(0.2);

    // ====== 6. Center fill (subtle glowing center) ======
    float center_dist = r / base_r;
    float center_alpha = 0.0;
    if (r < base_r - RING_THICKNESS * 0.5 - INNER_GLOW_R * 0.5) {
        float cd = 1.0 - smoothstep(0.0, 0.7, center_dist);
        center_alpha = cd * 0.04 * avg_amp;
    }
    vec3 center_col = get_gradient_color(0.1);

    // ====== Composite all layers ======
    vec3 final_col = bg_color;
    float final_alpha = 0.0;

    // Layer order from back to front: ambient glow -> outer glow -> inner glow -> center -> ring -> bars
    // Ambient glow
    final_col = mix(final_col, glow_col, ambient_alpha);
    // Outer glow shadow
    final_col = mix(final_col, glow_col, glow_alpha * 0.7);
    // Inner glow
    final_col = mix(final_col, inner_glow_col, inner_glow_alpha);
    // Center fill
    final_col = mix(final_col, center_col, center_alpha);
    // Base ring
    final_col = mix(final_col, ring_col, ring_alpha);
    // Bars (top layer)
    final_col = mix(final_col, bar_col, bar_alpha);

    // Bar edge bloom - extra bright edge on bar tips
    float tip_bloom = 0.0;
    if (r > bar_outer - bar_dr * 2.0 && r < bar_outer + bar_dr * 2.0) {
        float td = 1.0 - abs(r - bar_outer) / (bar_dr * 2.0);
        tip_bloom = td * td * ang_mask * amp * 0.5;
    }
    final_col += vec3(1.0) * tip_bloom;

    fragColor = vec4(final_col, 1.0);
}
