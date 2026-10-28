import { useIsFocused } from '@react-navigation/native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

/**
 * Flowing colour, drawn on the GPU.
 *
 * The aurora wallpaper is two blurred circles sliding about, which is all a
 * view can do. Liquid needs the colours to *bend into each other*, and that
 * is a fragment shader: the coordinate plane is warped by itself a few times
 * (domain warping), so straight gradients fold into the slow eddies of ink in
 * water. A thin band of light runs along the folds, the caustic you see on the
 * bottom of a pool, which is what sells it as liquid rather than gradient.
 *
 * One `Fill` with one shader, uniforms driven from the UI thread by Skia's
 * clock, so it never touches React after mount. It stops when the screen it
 * sits on is covered (the tab shell keeps rendering under a pushed chat
 * otherwise) and when the OS asks for reduced motion: the colours stay, the
 * movement goes.
 */

const SKSL = `
uniform float2 u_res;
uniform float u_time;
uniform float3 u_a;
uniform float3 u_b;
uniform float3 u_base;
uniform float u_mix;
uniform float u_glow;

half4 main(float2 p) {
  float2 uv = p / u_res;
  float2 q = float2(uv.x * (u_res.x / u_res.y), uv.y) * 1.6;
  float t = u_time * 0.00011;

  float2 w = q;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    w += 0.42 * float2(
      sin(w.y * 1.7 + t * 2.3 + fi * 1.3),
      cos(w.x * 1.5 - t * 1.9 + fi * 2.1)
    );
  }

  float s = 0.5 + 0.5 * sin(w.x * 1.2 + t * 3.0);
  float r = 0.5 + 0.5 * cos(w.y * 1.4 - t * 2.4);
  float3 mid = clamp(mix(u_a, u_b, 0.5) + 0.18, 0.0, 1.0);
  float3 col = mix(u_a, u_b, s);
  col = mix(col, mid, r * 0.55);

  float band = sin((w.x + w.y) * 3.2 + t * 5.0);
  float caustic = pow(0.5 + 0.5 * band, 18.0);
  col += caustic * u_glow;

  col = mix(u_base, col, u_mix);
  return half4(half3(col), 1.0);
}
`;

const EFFECT = Skia.RuntimeEffect.Make(SKSL);

function rgb(color: string): [number, number, number] {
  const c = color.trim();
  const hex = /^#([0-9a-f]{6})/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const short = /^#([0-9a-f]{3})$/i.exec(c);
  if (short) {
    const [r, g, b] = short[1].split('').map((h) => parseInt(h + h, 16) / 255);
    return [r, g, b];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (fn) {
    const [r, g, b] = fn[1].split(',').map((v) => Number(v.trim()) / 255);
    if ([r, g, b].every((v) => Number.isFinite(v))) return [r, g, b];
  }
  return [0, 0, 0];
}

export function LiquidBackdrop({
  tint,
  accent,
  base,
  dark,
}: {
  /** Usually the theme's primary. */
  tint: string;
  /** The second hue; the theme's `info`. */
  accent: string;
  /** What the colour fades into: the theme's background. */
  base: string;
  /** Dark grounds take the colour deeper and the glints softer. */
  dark: boolean;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const focused = useIsFocused();
  const clock = useClock();

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduceMotion(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const still = reduceMotion || !focused;
  const a = rgb(tint);
  const b = rgb(accent);
  const g = rgb(base);
  const w = size.w;
  const h = size.h;

  // Paused time is subtracted rather than skipped, so coming back to the
  // screen picks the flow up where it stopped instead of jumping to wherever
  // it would have drifted in the meantime.
  const pausedAt = useSharedValue(-1);
  const pausedFor = useSharedValue(0);
  useEffect(() => {
    if (still) {
      if (pausedAt.value < 0) pausedAt.value = clock.value;
    } else if (pausedAt.value >= 0) {
      pausedFor.value += clock.value - pausedAt.value;
      pausedAt.value = -1;
    }
  }, [still, clock, pausedAt, pausedFor]);

  // Offset into the loop: at t = 0 the warp has not had time to fold
  // anything yet, and the first frame would be a plain gradient.
  const uniforms = useDerivedValue(() => ({
    u_res: [Math.max(w, 1), Math.max(h, 1)],
    u_time:
      24000 + (pausedAt.value >= 0 ? pausedAt.value : clock.value) - pausedFor.value,
    u_a: a,
    u_b: b,
    u_base: g,
    u_mix: dark ? 0.62 : 0.5,
    u_glow: dark ? 0.12 : 0.22,
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: base }]}
      onLayout={onLayout}
    >
      {/* A shader that failed to compile leaves the plain ground, which is
          still a usable theme. */}
      {EFFECT && w > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={EFFECT} uniforms={uniforms} />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}
