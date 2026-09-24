/**
 * FORMAT · Text story — the POV / green-screen-less confession: nothing but
 * huge type, one line at a time, deadpan, then the number. 11 s.
 * Plays as a meme; the numbers are still the engine's.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage, BigNumber, TierBadge, Impact, EndCard, ATHLETE_LINE, type Cue, type FormatProps } from "./shared";
import { KineticText } from "../components/KineticText";
import { Bloom } from "../fx";
import { microLabel } from "../theme";
import { SAFE_RECT, beat } from "../timing";
import { DEMO, SCORE } from "../data";

export const STORY_DURATION = beat(22); // 11 s

const L1 = beat(0);
const L2 = beat(3);
const L3 = beat(6);
const L4 = beat(9);
const NUM = beat(11);
const END = beat(15);

export const STORY_CUES: Cue[] = [
  { at: L1, name: "bass-hit", volume: 0.8 },
  { at: L2, name: "bass-hit", volume: 0.8 },
  { at: L3, name: "bass-hit", volume: 0.8 },
  { at: L4, name: "whoosh", volume: 0.7 },
  { at: NUM, name: "slam" },
  { at: END, name: "whoosh" },
  { at: END, name: "shimmer", volume: 0.5 },
];

const Line: React.FC<{ from: number; to: number; lines: string[][]; size?: number }> = ({ from, to, lines, size = 132 }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const out = interpolate(frame, [to - 4, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <KineticText lines={lines} at={from} budget={16} size={size} />
    </AbsoluteFill>
  );
};

export const TextStory: React.FC<FormatProps> = (p) => (
  <Stage {...p} cues={STORY_CUES} exitAt={STORY_DURATION - 14}>
    <Bloom color="green" intensity={0.15} x={300} y={700} size={1000} />
    <Bloom color="blue" intensity={0.12} x={800} y={1100} size={900} />
    <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: 190, ...microLabel(22), color: "rgba(250,250,250,0.45)" }}>{ATHLETE_LINE}</div>
    <Line from={L1} to={L2} lines={[["I", "bench"], [`*${DEMO.loggedSet.weightKg} kg.*`]]} />
    <Line from={L2} to={L3} lines={[["I", "run", "a"], [`_${DEMO.fiveK.timeLabel}_`, "5k."]]} />
    <Line from={L3} to={L4} lines={[["One", "app"], ["scored", "both."]]} />
    <Line from={L4} to={NUM} lines={[["Out", "of", "100:"]]} size={120} />
    <Impact at={NUM}>
      <BigNumber label="Split Index" value={SCORE.splitDisplay} at={NUM} y={640} size={300} />
      <TierBadge label={SCORE.splitTier} at={NUM + 8} y={1010} size={84} hold={END - NUM - 8} />
    </Impact>
    <EndCard at={END} question={["Your", "turn."]} />
  </Stage>
);
