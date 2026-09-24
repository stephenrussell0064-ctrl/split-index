/**
 * FORMAT · The gap — two bars, Lab from the left and Engine from the right,
 * grow to their scores on the same 0–100 scale. The distance between them is
 * the whole pitch. 10 s.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage, BigNumber, TierBadge, Impact, EndCard, ATHLETE_LINE, type Cue, type FormatProps } from "./shared";
import { CaptionTrack } from "../components/Captions";
import { Bloom, RAMP_OUT } from "../fx";
import { C, FONT, indexDisplay, microLabel } from "../theme";
import { SAFE_RECT, beat } from "../timing";
import { SCORE } from "../data";

export const TUG_DURATION = beat(20); // 10 s

const GROW = beat(1);
const GROW_END = beat(6);
const GAP_AT = beat(7);
const SPLIT_AT = beat(10);
const END = beat(14);

const lab = Number(SCORE.lab);
const engine = Number(SCORE.engine);
const gap = Math.round((lab - engine) * 10) / 10;

export const TUG_CUES: Cue[] = [
  { at: 0, name: "bass-hit", volume: 0.8 },
  { at: GROW, name: "riser", volume: 0.6 },
  { at: GAP_AT, name: "slam" },
  { at: SPLIT_AT, name: "bass-hit" },
  { at: END, name: "whoosh" },
  { at: END, name: "shimmer", volume: 0.5 },
];

const Bar: React.FC<{ side: "lab" | "engine"; value: number; y: number }> = ({ side, value, y }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [GROW, GROW_END], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: RAMP_OUT });
  const shown = value * p;
  const w = (SAFE_RECT.w - 60) * (shown / 100);
  const color = side === "lab" ? C.green : C.blue;
  const label = side === "lab" ? "Lab · strength" : "Engine · endurance";
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x + 30, width: SAFE_RECT.w - 60, top: y }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ ...microLabel(26), color }}>{label}</div>
        <div style={{ ...indexDisplay, fontSize: 84, color }}>{shown.toFixed(1)}</div>
      </div>
      <div style={{ position: "relative", height: 54, marginTop: 14, background: "rgba(255,255,255,0.06)", borderRadius: 14 }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: side === "lab" ? 0 : undefined, right: side === "engine" ? 0 : undefined, width: w, background: color, borderRadius: 14, boxShadow: `0 0 40px ${color}88` }} />
        {[25, 50, 75].map((t) => (
          <div key={t} style={{ position: "absolute", top: -6, bottom: -6, left: `${t}%`, width: 2, background: "rgba(255,255,255,0.12)" }} />
        ))}
      </div>
    </div>
  );
};

const Gap: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < GAP_AT || frame >= SPLIT_AT) return null;
  const s = spring({ frame: frame - GAP_AT, fps, config: { damping: 14, stiffness: 240 }, durationInFrames: 20 });
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 880, textAlign: "center", opacity: Math.min(1, s * 2), scale: String(interpolate(Math.min(1, s), [0, 1], [1.6, 1])) }}>
      <div style={{ ...microLabel(30), color: C.muted }}>The gap</div>
      <div style={{ ...indexDisplay, fontSize: 200, color: C.white, marginTop: 8, filter: "drop-shadow(0 0 40px rgba(250,250,250,0.35))" }}>{gap.toFixed(1)}</div>
      <div style={{ fontFamily: FONT.body, fontSize: 30, color: C.muted, marginTop: 6 }}>points between your two halves</div>
    </div>
  );
};

export const TugOfWar: React.FC<FormatProps> = (p) => (
  <Stage {...p} cues={TUG_CUES} exitAt={TUG_DURATION - 14}>
    <Bloom color="green" intensity={0.18} x={200} y={500} size={900} />
    <Bloom color="blue" intensity={0.16} x={880} y={700} size={900} />
    <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: 200, ...microLabel(24), color: C.muted }}>{ATHLETE_LINE}</div>
    <AbsoluteFill>
      <Bar side="lab" value={lab} y={300} />
      <Bar side="engine" value={engine} y={560} />
    </AbsoluteFill>
    <Impact at={GAP_AT}>
      <Gap />
    </Impact>
    <Impact at={SPLIT_AT}>
      <BigNumber label="Split Index" value={SCORE.splitDisplay} at={SPLIT_AT} y={880} size={220} />
      <TierBadge label={SCORE.splitTier} at={SPLIT_AT + 8} y={1170} size={68} />
    </Impact>
    {/* the gap block yields to the split block */}
    <CaptionTrack
      lines={[
        { at: 2, words: ["Two", "halves."] },
        { at: GROW_END, words: ["Same", "body."] },
        { at: GAP_AT + 4, words: ["That's", "the", "*gap.*"] },
        { at: SPLIT_AT + 4, words: ["One", "score.", "Out", "of", "100."], until: END },
      ]}
    />
    <EndCard at={END} question={["Close", "*your*", "_gap._"]} />
  </Stage>
);
