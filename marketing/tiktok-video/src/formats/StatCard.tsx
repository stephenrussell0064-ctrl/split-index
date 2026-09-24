/**
 * FORMAT · Stat card — the format that actually circulates in hybrid TikTok:
 * one athlete, a stacked list of numbers revealed a line at a time, the last
 * line being the one thing only this app can add. 12 s, loopable.
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import { Stage, StatLine, BigNumber, TierBadge, Impact, EndCard, ATHLETE_LINE, type Cue, type FormatProps } from "./shared";
import { CaptionTrack } from "../components/Captions";
import { Bloom, LightStreak } from "../fx";
import { microLabel, C } from "../theme";
import { SAFE_RECT, beat } from "../timing";
import { DEMO, SCORE } from "../data";

export const STATCARD_DURATION = beat(24); // 12 s

const lift = (k: string) => DEMO.lifts.find((l) => l.liftKey === k)!;

const LINES = [
  { at: beat(1), label: "Bench", sub: `${DEMO.loggedSet.weightKg} kg × ${DEMO.loggedSet.reps} · predicted 1RM ${lift("bench").oneRMKg} kg`, value: `${lift("bench").scoreDisplay} ${lift("bench").tier}`, color: C.green },
  { at: beat(2), label: "Squat", sub: `predicted 1RM ${lift("squat").oneRMKg} kg`, value: `${lift("squat").scoreDisplay} ${lift("squat").tier}`, color: C.green },
  { at: beat(3), label: "Deadlift", sub: `predicted 1RM ${lift("deadlift").oneRMKg} kg`, value: `${lift("deadlift").scoreDisplay} ${lift("deadlift").tier}`, color: C.green },
  { at: beat(4), label: "5k", sub: `${DEMO.fiveK.timeLabel} · ${DEMO.fiveK.paceLabel}`, value: `${DEMO.fiveK.scoreDisplay} ${DEMO.fiveK.tier}`, color: C.blue },
  { at: beat(5), label: "Lab · Engine", sub: "strength · endurance, out of 100", value: `${SCORE.lab} · ${SCORE.engine}`, color: C.white },
];
const REVEAL_AT = beat(7);
const END_AT = beat(16);

export const STATCARD_CUES: Cue[] = [
  ...LINES.map((l) => ({ at: l.at, name: "tick" as const, volume: 0.7 })),
  { at: REVEAL_AT - 48, name: "riser", volume: 0.7 },
  { at: REVEAL_AT, name: "slam" },
  { at: END_AT, name: "whoosh" },
  { at: END_AT, name: "shimmer", volume: 0.5 },
  { at: STATCARD_DURATION - 14, name: "whoosh-rev", volume: 0.7 },
];

export const StatCard: React.FC<FormatProps> = (p) => (
  <Stage {...p} cues={STATCARD_CUES} exitAt={STATCARD_DURATION - 14}>
    <Bloom color="green" intensity={0.18} x={300} y={600} size={1000} />
    <Bloom color="blue" intensity={0.14} x={800} y={1100} size={900} />
    <LightStreak y={240} color="green" width={1500} thickness={5} opacity={0.3} />
    <AbsoluteFill style={{ opacity: 1 }}>
      <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: 200, ...microLabel(24), color: C.muted }}>{ATHLETE_LINE}</div>
      {LINES.map((l, i) => (
        <StatLine key={l.label} {...l} y={300 + i * 132} size={54} />
      ))}
    </AbsoluteFill>
    <Impact at={REVEAL_AT}>
      <BigNumber label="Split Index" value={SCORE.splitDisplay} at={REVEAL_AT} y={1000} size={230} />
      <TierBadge label={SCORE.splitTier} at={REVEAL_AT + 10} y={1290} size={64} />
    </Impact>
    <CaptionTrack
      lines={[
        { at: 2, words: ["One", "athlete."] },
        { at: beat(5) + 8, words: ["Every", "number", "scored."] },
        { at: REVEAL_AT + 4, words: ["One", "*score.*"], until: END_AT },
      ]}
    />
    <EndCard at={END_AT} question={["Beat", "*these.*"]} />
  </Stage>
);
