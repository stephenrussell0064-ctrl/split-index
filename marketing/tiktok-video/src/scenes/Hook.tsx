/**
 * HOOK · 0.0–1.5 s. Black frame, bass hit, words slam in. No logo, no fade.
 * A light streak whips across on each line's first word; the first frame of
 * each line carries a chromatic-aberration impact.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { KineticText, scheduleLines } from "../components/KineticText";
import { Aberration, LightStreak, Vignette } from "../fx";
import { C } from "../theme";
import type { HookVariant } from "../hooks";

export const HookScene: React.FC<{ hook: HookVariant; size?: number }> = ({ hook, size }) => {
  const frame = useCurrentFrame();
  const { lineStarts } = scheduleLines(hook.lines);
  const impact = lineStarts.reduce((m, f) => Math.max(m, impactAt(frame, f)), 0);
  const words = hook.lines.reduce((n, l) => n + l.length, 0);
  const fontSize = size ?? (words > 9 ? 108 : words > 7 ? 120 : 136);

  return (
    <AbsoluteFill style={{ background: C.black }}>
      {lineStarts.map((f, i) => {
        const p = interpolate(frame, [f, f + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const o = interpolate(frame, [f, f + 3, f + 14], [0, 0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <LightStreak
            key={i}
            y={660 + i * 260}
            color={i % 2 === 0 ? "green" : "blue"}
            width={1500}
            thickness={10}
            opacity={o}
            drift={520}
            progress={i % 2 === 0 ? p : 1 - p}
          />
        );
      })}
      <Aberration amount={impact}>
        <KineticText lines={hook.lines} size={fontSize} />
      </Aberration>
      <Vignette strength={0.55} />
    </AbsoluteFill>
  );
};

// pure form of useImpact — several impacts folded into one value
const impactAt = (frame: number, at: number, frames = 5, peak = 12) => {
  const t = frame - at;
  if (t < 0 || t >= frames) return 0;
  return peak * (1 - t / frames) ** 2;
};
