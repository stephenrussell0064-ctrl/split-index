/**
 * The grade and the impact toolkit.
 *
 * Everything here is CSS/SVG driven by useCurrentFrame(), so it renders
 * deterministically and costs almost nothing. No CSS animations (forbidden in
 * Remotion), no WebGL.
 */
import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, Easing, spring, useVideoConfig } from "remotion";
import { C, RGB } from "../theme";

// ─────────────────────────────────────────────────────────────────────────────
// Easing presets — spring physics everywhere a thing moves, exp ramps into reveals
// ─────────────────────────────────────────────────────────────────────────────

/** Snappy, slightly overshooting — for slams. */
export const SPRING_SLAM = { damping: 14, stiffness: 260, mass: 0.9 } as const;
/** Firm, no overshoot — for UI settling into place. */
export const SPRING_SETTLE = { damping: 200, stiffness: 120 } as const;
/** Soft, cinematic — for the camera. */
export const SPRING_CAMERA = { damping: 40, stiffness: 60, mass: 1.4 } as const;
/** Bouncy — for pops. */
export const SPRING_POP = { damping: 12, stiffness: 320, mass: 0.7 } as const;

/** Speed ramp: slow in, then whips — the "into every reveal" curve. */
export const RAMP_IN = Easing.in(Easing.exp);
export const RAMP_OUT = Easing.out(Easing.exp);
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export const useSpring = (delay: number, config: Parameters<typeof spring>[0]["config"], durationInFrames?: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config, durationInFrames });
};

// ─────────────────────────────────────────────────────────────────────────────
// Film grain — re-seeded every frame; static grain reads as dirt on the lens.
// ─────────────────────────────────────────────────────────────────────────────

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none", mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%" preserveAspectRatio="none">
        <filter id={`grain-${frame}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame} stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${frame})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.7 }) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `radial-gradient(120% 78% at 50% 46%, transparent 48%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

// ─────────────────────────────────────────────────────────────────────────────
// Flash frames — 2–4 frames of colour over a cut. `at` is the cut frame.
// ─────────────────────────────────────────────────────────────────────────────

export const Flash: React.FC<{ at: number; frames?: number; color?: string; peak?: number }> = ({
  at,
  frames = 3,
  color = C.white,
  peak = 0.9,
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t >= frames) return null;
  const o = interpolate(t, [0, frames - 1], [peak, 0.15], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: "none", mixBlendMode: "screen" }} />;
};

// ─────────────────────────────────────────────────────────────────────────────
// Screen shake — decaying random offset for `frames` after `at`.
// ─────────────────────────────────────────────────────────────────────────────

export const useShake = (at: number, frames = 10, amplitude = 26) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t >= frames) return { x: 0, y: 0, r: 0 };
  const decay = 1 - t / frames;
  const a = amplitude * decay * decay;
  return {
    x: (random(`sx${at}-${t}`) * 2 - 1) * a,
    y: (random(`sy${at}-${t}`) * 2 - 1) * a,
    r: (random(`sr${at}-${t}`) * 2 - 1) * a * 0.06,
  };
};

export const Shake: React.FC<{ at: number; frames?: number; amplitude?: number; children: React.ReactNode }> = ({
  at,
  frames,
  amplitude,
  children,
}) => {
  const s = useShake(at, frames, amplitude);
  return (
    <AbsoluteFill style={{ translate: `${s.x}px ${s.y}px`, rotate: `${s.r}deg` }}>{children}</AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Chromatic aberration — RGB split, impact frames only. Renders the children
// three times: base, red-only shifted right, blue-only shifted left, screened.
// `amount` in px; 0 renders the children once with no overhead.
// ─────────────────────────────────────────────────────────────────────────────

export const AberrationDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
    <defs>
      <filter id="ca-red" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
      </filter>
      <filter id="ca-blue" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
      </filter>
      <filter id="ca-green" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
      </filter>
    </defs>
  </svg>
);

export const Aberration: React.FC<{ amount: number; children: React.ReactNode }> = ({ amount, children }) => {
  if (amount <= 0.01) return <AbsoluteFill>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: "url(#ca-green)" }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ filter: "url(#ca-red)", translate: `${amount}px 0px`, mixBlendMode: "screen" }}>
        {children}
      </AbsoluteFill>
      <AbsoluteFill style={{ filter: "url(#ca-blue)", translate: `${-amount}px 0px`, mixBlendMode: "screen" }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Aberration amount that spikes at `at` and decays over `frames`. */
export const useImpact = (at: number, frames = 5, peak = 14) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t >= frames) return 0;
  return peak * (1 - t / frames) ** 2;
};

// ─────────────────────────────────────────────────────────────────────────────
// Anamorphic light streaks — thin horizontal bars, heavy blur, brand colour.
// ─────────────────────────────────────────────────────────────────────────────

export const LightStreak: React.FC<{
  y: number;
  color?: "green" | "blue" | "white";
  width?: number;
  thickness?: number;
  opacity?: number;
  /** horizontal drift in px across the streak's life */
  drift?: number;
  /** 0–1 life progress driving the drift */
  progress?: number;
  x?: number;
}> = ({ y, color = "green", width = 1400, thickness = 6, opacity = 0.8, drift = 0, progress = 0, x = 540 }) => {
  const rgb = RGB[color];
  const dx = interpolate(progress, [0, 1], [-drift, drift]);
  return (
    <div
      style={{
        position: "absolute",
        left: x - width / 2 + dx,
        top: y - thickness / 2,
        width,
        height: thickness,
        borderRadius: thickness,
        opacity,
        pointerEvents: "none",
        background: `linear-gradient(90deg, rgba(${rgb},0) 0%, rgba(${rgb},0.9) 35%, rgba(${RGB.white},1) 50%, rgba(${rgb},0.9) 65%, rgba(${rgb},0) 100%)`,
        filter: `blur(${Math.max(2, thickness * 0.6)}px)`,
        mixBlendMode: "screen",
      }}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Bloom — a soft radial glow; `intensity` 0–1.
// ─────────────────────────────────────────────────────────────────────────────

export const Bloom: React.FC<{
  color?: "green" | "blue" | "white";
  intensity?: number;
  x?: number;
  y?: number;
  size?: number;
}> = ({ color = "green", intensity = 0.5, x = 540, y = 900, size = 900 }) => (
  <div
    style={{
      position: "absolute",
      left: x - size / 2,
      top: y - size / 2,
      width: size,
      height: size,
      borderRadius: "50%",
      pointerEvents: "none",
      opacity: intensity,
      background: `radial-gradient(circle, rgba(${RGB[color]},0.7) 0%, rgba(${RGB[color]},0.25) 35%, rgba(${RGB[color]},0) 70%)`,
      filter: "blur(40px)",
      mixBlendMode: "screen",
    }}
  />
);

// ─────────────────────────────────────────────────────────────────────────────
// Depth of field — a blurred, dimmed copy layered behind.
// ─────────────────────────────────────────────────────────────────────────────

export const Defocus: React.FC<{ blur?: number; opacity?: number; children: React.ReactNode }> = ({
  blur = 18,
  opacity = 0.55,
  children,
}) => (
  <AbsoluteFill style={{ filter: `blur(${blur}px)`, opacity, pointerEvents: "none" }}>{children}</AbsoluteFill>
);
