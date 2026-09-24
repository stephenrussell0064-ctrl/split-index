/**
 * FORMAT · Micro-loop — 5 s. The odometer counts 0 → the score, the tier
 * slams, one line of type, and it resets so it loops forever. Built for
 * rewatches and as a profile-pinned teaser.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage, TierBadge, Impact, type Cue, type FormatProps } from "./shared";
import { Odometer } from "../components/Odometer";
import { PopWord } from "../components/Captions";
import { Wordmark } from "../components/Brand";
import { Bloom, LightStreak } from "../fx";
import { microLabel, C } from "../theme";
import { SAFE_RECT, beat } from "../timing";
import { SCORE } from "../data";
import { scoreAt, tickFrames } from "../score-curve";

export const MICRO_DURATION = beat(10); // 5 s

const COUNT = 6;
const SLAM = beat(4) + 6;
const EXIT = MICRO_DURATION - 12;

export const MICRO_CUES: Cue[] = [
  { at: 0, name: "riser", volume: 0.7 },
  ...tickFrames(SCORE.split, 2).map((f) => ({ at: COUNT + f, name: "tick" as const, volume: 0.5 })),
  { at: SLAM, name: "slam" },
  { at: EXIT, name: "whoosh-rev", volume: 0.7 },
];

export const MicroLoop: React.FC<FormatProps> = (p) => {
  const frame = useCurrentFrame();
  const v = frame >= COUNT ? scoreAt(frame - COUNT, SCORE.split) : 0;
  const glow = v / SCORE.split;
  return (
    <Stage {...p} cues={MICRO_CUES} exitAt={EXIT} exitFrames={10}>
      <Bloom color="green" intensity={0.15 + glow * 0.5} x={490} y={860} size={1100} />
      <LightStreak y={620} color="green" width={1600} thickness={8} opacity={0.3 + glow * 0.5} drift={200} progress={glow} />
      <LightStreak y={1120} color="blue" width={1300} thickness={5} opacity={0.2 + glow * 0.3} drift={-160} progress={glow} />
      <div style={{ position: "absolute", left: 0, right: 140, top: 250, display: "flex", justifyContent: "center", opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" }) }}>
        <Wordmark size={60} />
      </div>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 560, textAlign: "center", ...microLabel(30), color: C.muted }}>Split Index · out of 100</div>
      <Impact at={SLAM}>
        <AbsoluteFill>
          <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 640, display: "flex", justifyContent: "center", filter: `drop-shadow(0 0 ${20 + glow * 50}px rgba(250,250,250,${0.2 + glow * 0.4}))` }}>
            <Odometer value={v} size={300} />
          </div>
          <TierBadge label={SCORE.splitTier} at={SLAM} y={1050} size={84} />
        </AbsoluteFill>
      </Impact>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 1300, display: "flex", justifyContent: "center", gap: 22 }}>
        {["What's", "*yours?*"].map((w, i) => (
          <PopWord key={w} word={w} at={SLAM + 8 + i * 4} size={84} />
        ))}
      </div>
    </Stage>
  );
};
