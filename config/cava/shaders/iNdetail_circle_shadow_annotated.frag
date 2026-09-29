// SPDX-License-Identifier: MIT
// ============================================================================
// CAVA 圆形阴影可视化着色器 (sdl_glsl) - 详细注释版
// 坐标系说明：
//   fragCoord ∈ [0,1]×[0,1]，原点在左下角，中心在 (0.5, 0.5)
//   偏移后 p = fragCoord - (0.5,0.5)，中心在原点
//   经过宽高比校正后：
//     r=0        → 圆心
//     r≈0.30     → 基环位置（默认 BASE_RADIUS）
//     r≈0.5      → 窗口边缘（上下左右）
//     r≈0.707    → 窗口四角
// ============================================================================
#version 330
in vec2 fragCoord;
out vec4 fragColor;

// CAVA 传入的 uniform 变量
uniform float bars[512];         // 各频段振幅数组，值范围 [0,1]
uniform int bars_count;          // 柱条数量
uniform int bar_width;           // 柱宽（像素，主要用于终端模式）
uniform int bar_spacing;         // 柱间距（像素）
uniform vec3 u_resolution;       // 窗口分辨率 (width, height, ?)
uniform vec3 bg_color;           // 背景色
uniform vec3 fg_color;           // 前景色
uniform int gradient_count;      // 渐变色数量
uniform vec3 gradient_colors[8]; // 渐变色数组
uniform float shader_time;       // 着色器运行时间（秒）

// ============================================================================
// ★★★ 基环大小相关参数总览 ★★★
//
//  径向布局（从圆心向外）：
//
//  0 ────────┬────────┬──────────┬──────┬──────┬──────────┬──────── r →
//            │        │          │      │      │          │
//       center   inner     ring   ring  bar_outer  glow_outer  ambient_outer
//        fill   glow     inner  outer  (静音时)   (最大音量)
//            │        │          │      │      │          │
//            ▼        ▼          ▼      ▼      ▼          ▼
//          0.00     ~0.271    0.296  0.304   0.484       0.529       0.54
//         (圆心)  (内发光内缘)(环内缘)(环外缘)(柱条外缘) (外发光外缘) (环境光外缘)
//
//  控制基环大小的参数有 4 个（直接控制）+ 4 个（间接影响视觉大小）：
//    直接控制：BASE_RADIUS, RING_THICKNESS, PULSE_AMP, PULSE_SPEED
//    间接影响：BAR_MAX_LEN, INNER_GLOW_R, OUTER_GLOW_W, AMBIENT_GLOW
// ============================================================================

// ============================================================================
// 【直接控制基环的参数】
// ============================================================================

// ─── 1. BASE_RADIUS：基环中心半径 ─────────────────────────────────────────
// 这是最核心的参数，控制整个圆环在窗口中的位置和大小。
//
// 公式：base_r = BASE_RADIUS × pulse
//   当 pulse=1（不呼吸时）：base_r = BASE_RADIUS = 0.30
//   当窗口为正方形 600×600 时：基环中心到圆心的距离 = 0.30 × (600/2) = 90 像素
//   即基环位于距圆心 90 像素处，圆环直径约 180 像素
//
// 推荐值：
//   0.20 = 小圆环（紧凑，适合角落小组件）
//   0.30 = 默认值（适中）
//   0.38 = 大圆环（占据窗口大部分）
//   0.45 = 极大圆环（接近窗口边缘）
const float BASE_RADIUS     = 0.30;

// ─── 2. RING_THICKNESS：基环厚度 ──────────────────────────────────────────
// 基环本身的径向宽度（粗细）。
//
// 公式：
//   ring_inner = base_r - RING_THICKNESS × 0.5   // 基环内边缘
//   ring_outer = base_r + RING_THICKNESS × 0.5   // 基环外边缘
//
//   默认值 0.008 时（窗口 600px）：
//     ring_inner = 0.30 - 0.004 = 0.296  → 距圆心 88.8 像素
//     ring_outer = 0.30 + 0.004 = 0.304  → 距圆心 91.2 像素
//     基环实际厚度 = 0.008 × (600/2) = 2.4 像素
//
// 推荐值：
//   0.004 = 细线（约 1.2 像素）
//   0.008 = 默认（约 2.4 像素）
//   0.015 = 粗线（约 4.5 像素）
//   0.025 = 很粗的环（约 7.5 像素）
const float RING_THICKNESS  = 0.008;

// ─── 3. PULSE_AMP：呼吸脉冲幅度 ──────────────────────────────────────────
// 基环会随时间做周期性缩放（呼吸效果），此参数控制缩放幅度。
//
// 公式：
//   pulse = 1.0 + PULSE_AMP × sin(t × PULSE_SPEED) × 0.5
//   base_r = BASE_RADIUS × pulse
//
//   默认值 0.03 时：
//     pulse 在 [0.985, 1.015] 之间波动
//     base_r 在 [0.2955, 0.3045] 之间波动（±1.5%）
//     在 600px 窗口中，基环半径波动约 ±1.35 像素
//
// 推荐值：
//   0.00  = 关闭呼吸效果，完全静止
//   0.03  = 默认（微妙呼吸）
//   0.08  = 明显呼吸
//   0.15  = 大幅脉动（像心跳）
const float PULSE_AMP       = 0.03;

// ─── 4. PULSE_SPEED：呼吸脉冲速度 ─────────────────────────────────────────
// 控制呼吸动画的速度（单位：弧度/秒，但近似为周期频率）。
//
// 公式：sin(t × PULSE_SPEED)
//   PULSE_SPEED=0.8 时：周期 ≈ 2π/0.8 ≈ 7.85 秒/次呼吸
//   PULSE_SPEED=2.0 时：周期 ≈ 3.14 秒/次呼吸（较快）
//   PULSE_SPEED=4.0 时：周期 ≈ 1.57 秒/次呼吸（很快）
const float PULSE_SPEED     = 0.8;

// ============================================================================
// 【间接影响基环视觉大小的参数】
// 这些参数不改变基环本身的位置，但改变发光/柱条的范围，
// 从而影响整个可视化的视觉"尺寸感"。
// ============================================================================

// ─── 5. BAR_MAX_LEN：柱条最大长度 ────────────────────────────────────────
// 柱条从基环外边缘向外延伸的最大长度（当振幅 amp=1 时）。
//
// 公式：
//   bar_len  = amp_boost × BAR_MAX_LEN          // 当前柱条实际长度
//   bar_outer = ring_outer + bar_len             // 柱条外边缘
//     = base_r + RING_THICKNESS×0.5 + amp_boost × BAR_MAX_LEN
//
//   其中 amp_boost = pow(amp, 0.85) × (1 + 0.4×(1-amp))
//     这是一个非线性响应曲线：
//     amp=0   → amp_boost=0        → bar_len=0    （静音，柱条不可见）
//     amp=0.5 → amp_boost≈0.66     → bar_len≈0.119
//     amp=1   → amp_boost≈1.0      → bar_len=0.18 （最大音量）
//
//   默认值 0.18 时（窗口 600px）：
//     柱条最大外边缘 = 0.304 + 0.18 = 0.484 → 距圆心 145.2 像素
//     柱条最长 = 0.18 × 300 = 54 像素
//
// 推荐值：
//   0.08 = 短柱条（约 24 像素长，紧凑）
//   0.18 = 默认（约 54 像素长）
//   0.25 = 长柱条（约 75 像素长，视觉冲击强）
const float BAR_MAX_LEN     = 0.18;

// ─── 6. INNER_GLOW_R：内发光宽度 ─────────────────────────────────────────
// 基环向内（朝向圆心）散发辉光的宽度。
//
// 公式：
//   内发光范围 = [ring_inner - INNER_GLOW_R, ring_inner]
//   默认值 0.025 时：
//     内发光内缘 = 0.296 - 0.025 = 0.271 → 距圆心 81.3 像素
//     内发光外缘 = ring_inner = 0.296     → 距圆心 88.8 像素
//     内发光宽度 = 0.025 × 300 = 7.5 像素
//
// 增大此值会让基环看起来"更厚"、有向内发光的深度感。
const float INNER_GLOW_R    = 0.025;

// ─── 7. OUTER_GLOW_W：外发光宽度 ─────────────────────────────────────────
// 柱条尖端向外散发辉光的宽度（阴影效果）。
//
// 公式：
//   glow_outer = bar_outer + OUTER_GLOW_W × amp_boost
//   默认值 0.045 时（最大音量）：
//     glow_outer = 0.484 + 0.045 = 0.529 → 距圆心 158.7 像素
//     外发光宽度 = 0.045 × 300 = 13.5 像素
//
// 增大此值会让柱条有更明显的"光晕"阴影效果。
const float OUTER_GLOW_W    = 0.045;

// ─── 8. AMBIENT_GLOW：环境光晕宽度 ───────────────────────────────────────
// 整个圆环外围的漫射环境光宽度（比外发光更宽更柔和）。
//
// 公式：
//   ambient_outer = base_r + BAR_MAX_LEN + AMBIENT_GLOW
//   默认值时：
//     ambient_outer = 0.30 + 0.18 + 0.06 = 0.54 → 距圆心 162 像素
//     环境光晕外缘接近窗口边缘（r=0.5）
//
// 注意：ambient_outer 是固定值（不随单个柱条振幅变化），
// 它代表整个圆形的最大视觉外边界。
const float AMBIENT_GLOW    = 0.06;

// ============================================================================
// 【其他视觉参数】（不影响基环大小，但影响外观）
// ============================================================================
const float GLOW_INTENSITY  = 0.55;   // 发光强度（0=无辉光，1=最亮）
const float SHADOW_SOFTNESS = 0.012;  // 柱条边缘抗锯齿柔和度
const float BARS_GAP        = 0.25;   // 柱条间角度间隙比例（0=紧密，0.5=柱隙各半）

// ============================================================================
// 辅助函数
// ============================================================================

// 颜色线性插值：将值 y 在 [y1,y2] 区间映射到颜色 [c1,c2]
vec3 normalize_C(float y, vec3 c1, vec3 c2, float y1, float y2) {
    float t = clamp((y - y1) / max(y2 - y1, 0.0001), 0.0, 1.0);
    return mix(c1, c2, t);
}

// 采样角度位置 a（0~1）处的音频振幅，带平滑插值
float sample_bar(float a) {
    int bc = min(bars_count, 512);
    if (bc <= 0) return 0.0;
    float cell = a * float(bc);         // 将角度映射到柱条索引
    int i0 = int(floor(cell));          // 左侧柱条索引
    i0 = clamp(i0, 0, bc - 1);
    int i1 = i0 + 1;
    if (i1 >= bc) i1 = 0;               // 循环回第0根
    float f = fract(cell);              // 小数部分
    f = smoothstep(0.0, 1.0, f);        // 平滑插值（避免柱条间硬边）
    float v0 = clamp(bars[i0], 0.0, 1.0);
    float v1 = clamp(bars[i1], 0.0, 1.0);
    return mix(v0, v1, f);              // 双线性插值
}

// 根据振幅获取渐变色
vec3 get_gradient_color(float amp) {
    if (gradient_count == 0) return fg_color;
    if (gradient_count == 1) return gradient_colors[0];
    int idx = int(floor(float(gradient_count - 1) * amp));
    idx = clamp(idx, 0, gradient_count - 2);
    float y0 = float(idx) / float(gradient_count - 1);
    float y1 = float(idx + 1) / float(gradient_count - 1);
    return normalize_C(amp, gradient_colors[idx], gradient_colors[idx + 1], y0, y1);
}

// ============================================================================
// 主渲染函数 - 每个像素执行一次
// ============================================================================
void main() {
    // ── 坐标变换 ──────────────────────────────────────────────────────────
    vec2 p = fragCoord - vec2(0.5);                    // 将原点移至中心
    p.x *= u_resolution.x / u_resolution.y;            // 宽高比校正，保证圆形不变形
    // 校正后，对于 600×600 窗口：p ∈ [-0.5, 0.5] × [-0.5, 0.5]

    float r = length(p);                               // 到圆心的距离（极坐标半径）
    float theta = atan(p.y, p.x);                      // 极角（弧度），范围 [-π, π]
    float pi = 3.14159265359;
    float tau = pi * 2.0;
    float a = fract((theta + pi) / tau);               // 角度位置归一化到 [0,1]，0=右,0.25=上,0.5=左,0.75=下

    float px = max(length(dFdx(p)), length(dFdy(p)));  // 屏幕像素对应的 NDC 距离（用于抗锯齿）
    float t = shader_time;

    // ── 呼吸脉冲计算 ──────────────────────────────────────────────────────
    // 公式：pulse = 1 + PULSE_AMP × sin(t × PULSE_SPEED) × 0.5
    // sin 输出范围 [-1, 1]，乘以 0.5×PULSE_AMP 后范围是 [-PULSE_AMP×0.5, PULSE_AMP×0.5]
    // 所以 pulse ∈ [1 - PULSE_AMP/2, 1 + PULSE_AMP/2]
    // 默认：pulse ∈ [0.985, 1.015]
    float pulse = 1.0 + PULSE_AMP * sin(t * PULSE_SPEED) * 0.5;

    // 公式：base_r = BASE_RADIUS × pulse
    // 这是经过呼吸调制后的基环中心半径
    float base_r = BASE_RADIUS * pulse;

    // ========================================================================
    // 第一层：计算柱条几何（径向边界）
    // ========================================================================
    float amp = sample_bar(a);                         // 当前角度的音频振幅 [0,1]

    // 非线性振幅增强：对小振幅有提升效果，使视觉更饱满
    // pow(amp, 0.85)：gamma<1 提亮暗部，让小信号也能显示
    // (1 + 0.4×(1-amp))：中低振幅额外增益，避免柱条过短
    float amp_boost = pow(amp, 0.85) * (1.0 + 0.4 * (1.0 - amp));

    // 柱条长度 = 增强振幅 × 最大长度
    float bar_len = amp_boost * BAR_MAX_LEN;

    // 公式：bar_outer = base_r + RING_THICKNESS/2 + bar_len
    //   柱条外边缘 = 基环中心 + 基环半厚 + 柱条长度
    //   静音时 bar_len=0，bar_outer = ring_outer（与基环外边缘重合）
    //   最大音量时 bar_outer = 0.30 + 0.004 + 0.18 = 0.484
    float bar_outer = base_r + RING_THICKNESS * 0.5 + bar_len;

    // 公式：bar_inner = base_r - RING_THICKNESS/2 = ring_inner
    //   柱条内边缘与基环内边缘对齐
    float bar_inner = base_r - RING_THICKNESS * 0.5;

    // ── 角度方向的柱条间隙 ────────────────────────────────────────────────
    float fill = 1.0 - BARS_GAP;                       // 柱条占每格宽度的比例
    float cell = a * float(min(bars_count, 512));      // 角度对应的柱条格编号
    float f = fract(cell);                             // 格内位置 [0,1]
    float ang = abs(f - 0.5);                          // 到格中心的距离 [0, 0.5]
    float df = 0.5 * (float(min(bars_count, 512)) * px) / (tau * max(r, px)); // 像素级抗锯齿偏移
    float ang_mask = 1.0 - smoothstep(fill * 0.5 - df, fill * 0.5 + df, ang); // 角度方向掩码，柱条区域=1，间隙=0

    // ========================================================================
    // 第二层：基环（内圆环）
    // ========================================================================
    // 公式：
    //   ring_inner = base_r - RING_THICKNESS/2  （基环内边缘）
    //   ring_outer = base_r + RING_THICKNESS/2  （基环外边缘）
    float ring_inner = base_r - RING_THICKNESS * 0.5;
    float ring_outer = base_r + RING_THICKNESS * 0.5;

    // ring_dr：基环边缘的抗锯齿宽度（限制在1~3像素对应的NDC距离）
    float ring_dr = clamp(px, 0.001, 0.003);

    // 使用两个 smoothstep 构建环形蒙版：
    //   第一个 smoothstep：r 从 ring_inner-ring_dr 到 ring_inner+ring_dr 时从0渐变到1
    //   第二个 smoothstep：r 从 ring_outer-ring_dr 到 ring_outer+ring_dr 时从1渐变到0
    //   两者相乘得到 [ring_inner, ring_outer] 区间内的平滑环形alpha
    float ring_alpha = smoothstep(ring_inner - ring_dr, ring_inner + ring_dr, r) *
                       (1.0 - smoothstep(ring_outer - ring_dr, ring_outer + ring_dr, r));

    // 基环亮度随音量变化：越响越亮
    float avg_amp = amp * 0.5 + 0.3;
    vec3 ring_col = get_gradient_color(0.3) * avg_amp;
    ring_alpha *= 0.7 + 0.3 * amp;

    // ========================================================================
    // 第三层：柱条
    // ========================================================================
    float bar_dr = max(SHADOW_SOFTNESS, px * 1.5);    // 柱条径向抗锯齿宽度
    float bar_inner_mask = smoothstep(bar_inner - bar_dr, bar_inner + bar_dr, r); // 内边缘蒙版
    float bar_outer_mask = 1.0 - smoothstep(bar_outer - bar_dr, bar_outer + bar_dr, r); // 外边缘蒙版
    float bar_alpha = bar_inner_mask * bar_outer_mask * ang_mask; // 柱条总alpha=径向×角度
    bar_alpha *= smoothstep(0.0, 0.02, amp);          // 静音时淡出（amp<0.02 不可见）
    vec3 bar_col = get_gradient_color(amp_boost);
    // 柱条尖端白色高光：越靠近尖端越亮
    float tip_fade = smoothstep(bar_outer - bar_dr * 3.0, bar_outer, r);
    bar_col = mix(bar_col, vec3(1.0), tip_fade * 0.4 * amp);

    // ========================================================================
    // 第四层：外发光阴影（柱条尖端向外的辉光）
    // ========================================================================
    // glow_outer = bar_outer + OUTER_GLOW_W × amp_boost
    // 发光宽度随振幅增大而增大（音量越大，光晕越宽）
    float glow_outer = bar_outer + OUTER_GLOW_W * amp_boost;
    float glow_dist = (r - bar_outer) / max(OUTER_GLOW_W * amp_boost + px, 0.001); // 0=在柱条尖端, 1=在发光外缘
    float glow_alpha = 0.0;
    if (r > bar_outer && r < glow_outer && ang_mask > 0.01) {
        float gd = smoothstep(1.0, 0.0, glow_dist);  // 从外到内渐变增强
        glow_alpha = gd * gd * ang_mask * GLOW_INTENSITY * amp; // 平方衰减，随音量增强
    }

    // 环境光晕：更宽更柔和的外围光（不随角度变化的均匀环境光）
    // ambient_outer = base_r + BAR_MAX_LEN + AMBIENT_GLOW（固定最大值，不随单根柱条变）
    float ambient_outer = base_r + BAR_MAX_LEN + AMBIENT_GLOW;
    float ambient_dist = (r - bar_outer) / max(AMBIENT_GLOW + px, 0.001);
    float ambient_alpha = 0.0;
    if (r > bar_outer && r < ambient_outer) {
        float ad = smoothstep(1.0, 0.0, ambient_dist);
        ambient_alpha = ad * ad * ad * 0.15 * amp;   // 立方衰减，很柔和
    }
    vec3 glow_col = get_gradient_color(amp_boost * 0.8);

    // ========================================================================
    // 第五层：内发光（基环向内的辉光，制造深度感）
    // ========================================================================
    // 内发光范围：[ring_inner - INNER_GLOW_R, ring_inner]
    float inner_glow_dist = (ring_inner - r) / max(INNER_GLOW_R + px, 0.001); // 0=在内缘, 1=在内发光内缘
    float inner_glow_alpha = 0.0;
    if (r < ring_inner && r > ring_inner - INNER_GLOW_R) {
        float igd = smoothstep(1.0, 0.0, inner_glow_dist);
        inner_glow_alpha = igd * igd * 0.25 * (0.5 + 0.5 * avg_amp);
    }
    vec3 inner_glow_col = get_gradient_color(0.2);

    // ========================================================================
    // 第六层：中心填充（圆心处的微妙光晕）
    // ========================================================================
    // 中心区域：r < ring_inner - INNER_GLOW_R×0.5 - RING_THICKNESS×0.5
    float center_dist = r / base_r;                   // 0=圆心, 1=基环中心
    float center_alpha = 0.0;
    if (r < base_r - RING_THICKNESS * 0.5 - INNER_GLOW_R * 0.5) {
        float cd = 1.0 - smoothstep(0.0, 0.7, center_dist); // 从中心向外衰减
        center_alpha = cd * 0.04 * avg_amp;           // 非常淡的填充
    }
    vec3 center_col = get_gradient_color(0.1);

    // ========================================================================
    // 合成：从后往前逐层混合（alpha blending）
    // 顺序：环境光晕 → 外发光 → 内发光 → 中心填充 → 基环 → 柱条 → 尖端高光
    // ========================================================================
    vec3 final_col = bg_color;
    final_col = mix(final_col, glow_col, ambient_alpha);    // 最远层：环境光晕
    final_col = mix(final_col, glow_col, glow_alpha * 0.7); // 外发光阴影
    final_col = mix(final_col, inner_glow_col, inner_glow_alpha); // 内发光
    final_col = mix(final_col, center_col, center_alpha);   // 中心填充
    final_col = mix(final_col, ring_col, ring_alpha);       // 基环
    final_col = mix(final_col, bar_col, bar_alpha);         // 柱条（最上层实体）

    // 柱条尖端 Bloom 效果：额外的白色亮光
    float tip_bloom = 0.0;
    if (r > bar_outer - bar_dr * 2.0 && r < bar_outer + bar_dr * 2.0) {
        float td = 1.0 - abs(r - bar_outer) / (bar_dr * 2.0);
        tip_bloom = td * td * ang_mask * amp * 0.5;
    }
    final_col += vec3(1.0) * tip_bloom;

    fragColor = vec4(final_col, 1.0);
}
