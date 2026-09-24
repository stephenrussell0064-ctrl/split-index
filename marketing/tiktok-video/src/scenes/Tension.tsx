/**
 * TENSION · 1.5–4.0 s. Five beats, a cut on every one. Lab (black/green)
 * against Engine (white/blue), colliding toward the centre seam. No footage
 * exists under /assets/footage, so these are abstract kinetic graphics: a
 * barbell plate spinning, a pace line drawing itself, a heart-rate trace.
 *
 * Deliberately no numbers anywhere in this scene — every number in the film
 * has to come from the engine, and these graphics are texture, not data.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { C, FONT, microLabel } from "../theme";
import { beat, WIDTH, HEIGHT } from "../timing";
import { Aberration, Flash, Shake, useImpact, RAMP_IN, LightStreak } from "../fx";
import { CaptionTrack } from "../components/Captions";
import type { HookVariant } from "../hooks";

// ── graphics ────────────────────────────────────────────────────────────────

const Plate: React.FC<{ speed?: number; size?: number; cx?: number; cy?: number }> = ({ speed = 14, size = 620, cx = 270, cy = 900 }) => {
  const frame = useCurrentFrame();
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} style={{ position: "absolute", left: cx - r, top: cy - r, filter: "drop-shadow(0 0 40px rgba(61,255,110,0.35))" }}>
      <g transform={`rotate(${frame * speed})`}>
        <circle r={r - 6} fill="#0a0d0b" stroke={C.green} strokeWidth={8} />
        <circle r={r * 0.72} fill="none" stroke="rgba(61,255,110,0.35)" strokeWidth={3} />
        <circle r={r * 0.18} fill="#050605" stroke={C.green} strokeWidth={6} />
        {[0, 90, 180, 270].map((a) => (
          <rect key={a} x={-18} y={-r * 0.62} width={36} height={r * 0.32} rx={10} fill="rgba(61,255,110,0.55)" transform={`rotate(${a})`} />
        ))}
        <path d={`M ${-r * 0.95} 0 A ${r * 0.95} ${r * 0.95} 0 0 1 0 ${-r * 0.95}`} fill="none" stroke={C.greenSoft} strokeWidth={14} strokeLinecap="round" opacity={0.9} />
      </g>
    </svg>
  );
};

const wave = (n: number, seed: number, amp: number) =>
  Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1);
    return Math.sin(x * 9 + seed) * amp * 0.5 + Math.sin(x * 23 + seed * 2) * amp * 0.3 + Math.sin(x * 61 + seed * 3) * amp * 0.2;
  });

/** A line that draws itself left→right. `progress` 0–1. */
const DrawnLine: React.FC<{ points: number[]; progress: number; color: string; x: number; y: number; w: number; h: number; width?: number; glow?: string }> = ({
  points,
  progress,
  color,
  x,
  y,
  w,
  h,
  width = 8,
  glow,
}) => {
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (points.length - 1)) * w} ${h / 2 - p}`).join(" ");
  const len = w * 1.6;
  return (
    <svg width={w} height={h} style={{ position: "absolute", left: x, top: y, overflow: "visible", filter: glow ? `drop-shadow(0 0 22px ${glow})` : undefined }}>
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - progress)} />
    </svg>
  );
};

const ecg = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const x = (i / n) * 4; // four beats across
    const t = x % 1;
    if (t < 0.08) return 0;
    if (t < 0.12) return 18;
    if (t < 0.16) return -30;
    if (t < 0.22) return 160;
    if (t < 0.28) return -60;
    if (t < 0.5) return 0;
    if (t < 0.62) return 28 * Math.sin(((t - 0.5) / 0.12) * Math.PI);
    return 0;
  });

const LabPanel: React.FC<{ progress: number; label?: boolean }> = ({ progress, label = true }) => (
  <AbsoluteFill style={{ background: C.labBg, overflow: "hidden" }}>
    <Plate cx={WIDTH * 0.5} cy={HEIGHT * 0.47} size={interpolate(progress, [0, 1], [560, 720])} />
    {label ? <div style={{ position: "absolute", left: 60, top: 220, ...microLabel(30), color: C.green }}>The Lab · Strength</div> : null}
  </AbsoluteFill>
);

const EnginePanel: React.FC<{ progress: number; kind: "pace" | "hr"; label?: boolean }> = ({ progress, kind, label = true }) => (
  <AbsoluteFill style={{ background: C.engineBg, overflow: "hidden" }}>
    {kind === "pace" ? (
      <DrawnLine points={wave(160, 2.1, 300)} progress={progress} color={C.blue} x={-40} y={HEIGHT * 0.47 - 300} w={WIDTH + 80} h={600} width={12} glow="rgba(59,166,255,0.55)" />
    ) : (
      <DrawnLine points={ecg(320).map((v) => v * 1.7)} progress={progress} color={C.blue} x={-40} y={HEIGHT * 0.47 - 300} w={WIDTH + 80} h={600} width={11} glow="rgba(59,166,255,0.5)" />
    )}
    {label ? (
      <div style={{ position: "absolute", left: 60, top: 220, ...microLabel(30), color: C.blueText }}>
        The Engine · {kind === "pace" ? "Pace" : "Heart rate"}
      </div>
    ) : null}
  </AbsoluteFill>
);

// ── the scene ───────────────────────────────────────────────────────────────

export const TensionScene: React.FC<{ hook: HookVariant }> = ({ hook }) => {
  const frame = useCurrentFrame();
  const shot = Math.min(4, Math.floor(frame / beat(1)));
  const local = frame - shot * beat(1);
  const p = interpolate(local, [0, beat(1)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  // collision: from shot 3 the halves travel to the seam; they hit at the start of shot 4
  const hit = beat(4);
  const travel = interpolate(frame, [beat(3), hit], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: RAMP_IN });
  const impact = useImpact(hit, 6, 16);

  const captions = hook.subvert
    ? [
        { at: 0, words: hook.subvert, stagger: 5 },
        { at: beat(2), words: ["Same", "body."] },
        { at: beat(4), words: ["One", "*score.*"] },
      ]
    : [
        { at: 0, words: ["Your", "*lifting.*"] },
        { at: beat(1), words: ["Your", "_running._"] },
        { at: beat(2), words: ["Same", "body."] },
        { at: beat(4), words: ["One", "*score.*"] },
      ];

  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Shake at={hit} frames={10} amplitude={30}>
        <Aberration amount={impact}>
          {shot === 0 ? (
            // split vertical: Lab left, Engine right, hard seam
            <>
              <div style={{ position: "absolute", inset: 0, clipPath: "inset(0 50% 0 0)" }}>
                <LabPanel progress={p} />
              </div>
              <div style={{ position: "absolute", inset: 0, clipPath: "inset(0 0 0 50%)" }}>
                <EnginePanel progress={p} kind="pace" label={false} />
              </div>
              <div style={{ position: "absolute", left: WIDTH / 2 - 3, top: 0, bottom: 0, width: 6, background: C.white }} />
            </>
          ) : null}
          {shot === 1 ? <EnginePanel progress={p} kind="hr" /> : null}
          {shot === 2 ? <LabPanel progress={p} /> : null}
          {shot >= 3 ? (
            <>
              {/* the Lab stays underneath so the frame never goes black while the halves travel */}
              <AbsoluteFill style={{ opacity: 1 - travel }}>
                <LabPanel progress={1} />
              </AbsoluteFill>
              {/* top: Lab, bottom: Engine, travelling to the seam at 50% */}
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 ${interpolate(travel, [0, 1], [100, 50])}% 0)` }}>
                <AbsoluteFill style={{ translate: `0px ${interpolate(travel, [0, 1], [-HEIGHT * 0.5, 0])}px` }}>
                  <LabPanel progress={1} label={false} />
                </AbsoluteFill>
              </div>
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(${interpolate(travel, [0, 1], [100, 50])}% 0 0 0)` }}>
                <AbsoluteFill style={{ translate: `0px ${interpolate(travel, [0, 1], [HEIGHT * 0.5, 0])}px` }}>
                  <EnginePanel progress={1} kind="pace" label={false} />
                </AbsoluteFill>
              </div>
              {/* the seam glows as they close */}
              <LightStreak y={HEIGHT / 2} color="white" width={1400} thickness={interpolate(travel, [0.7, 1], [0, 26], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} opacity={travel} />
            </>
          ) : null}
        </Aberration>
      </Shake>
      {/* flash on every beat, hard white on the hit */}
      {[1, 2, 3].map((b) => (
        <Flash key={b} at={beat(b)} frames={2} peak={0.55} color={b % 2 ? C.white : C.green} />
      ))}
      <Flash at={hit} frames={4} peak={1} />
      <CaptionTrack lines={captions} />
      {/* logo-free, but the film's font shows up in the wordmarks of the panels */}
      <div style={{ display: "none", fontFamily: FONT.body }} />
    </AbsoluteFill>
  );
};
