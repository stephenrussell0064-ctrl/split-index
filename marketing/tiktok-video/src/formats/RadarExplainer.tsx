/**
 * FORMAT · Radar explainer — the Interference Radar finding as a 13 s
 * mini-explainer: question, the per-day bars, the engine's sentence,
 * the sample size, the ask.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage, Impact, EndCard, ATHLETE_LINE, type Cue, type FormatProps } from "./shared";
import { RadarDish, HeadlineStat, DecayBars, TypedFinding, RadarBackground } from "../components/Radar";
import { KineticText } from "../components/KineticText";
import { CaptionTrack } from "../components/Captions";
import { microLabel, C } from "../theme";
import { SAFE_RECT, beat } from "../timing";
import { RADAR } from "../data";

export const RADAR_DURATION = beat(26); // 13 s

const OPEN = beat(1);
const HEADLINE = beat(5);
const BARS = beat(6);
const TYPE = beat(6) + 8;
const TYPE_END = beat(14);
const END = beat(19);

export const RADAR_CUES: Cue[] = [
  { at: 0, name: "bass-hit", volume: 0.8 },
  { at: OPEN, name: "whoosh-rev", volume: 0.6 },
  { at: HEADLINE - 30, name: "riser", volume: 0.6 },
  { at: HEADLINE, name: "slam" },
  { at: BARS, name: "tick", volume: 0.6 },
  { at: BARS + 4, name: "tick", volume: 0.6 },
  { at: END, name: "whoosh" },
  { at: END, name: "shimmer", volume: 0.5 },
];

const QuestionBlock: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame >= HEADLINE) return null;
  const out = interpolate(frame, [HEADLINE - 6, HEADLINE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <KineticText lines={[["Does", "*lifting*"], ["slow", "your"], ["_cardio?_"]]} at={0} budget={24} size={128} vAlign="top" inset={120} />
    </AbsoluteFill>
  );
};

export const RadarExplainer: React.FC<FormatProps> = (p) => (
  <Stage {...p} cues={RADAR_CUES} exitAt={RADAR_DURATION - 14}>
    <RadarBackground />
    <AbsoluteFill style={{ opacity: 1 }}>
      <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: 200, ...microLabel(24), color: C.muted }}>{ATHLETE_LINE}</div>
      {/* the question, big, before the radar opens */}
      <QuestionBlock />
    </AbsoluteFill>
    <div style={{ position: "absolute", inset: 0, translate: "0px 560px", scale: "0.7", opacity: 0.45 }}>
      <RadarDish openAt={OPEN} />
    </div>
    <Impact at={HEADLINE}>
      <AbsoluteFill style={{ translate: "0px -40px" }}>
        <HeadlineStat at={HEADLINE} />
      </AbsoluteFill>
    </Impact>
    <DecayBars at={BARS} y={690} />
    <TypedFinding from={TYPE} to={TYPE_END} y={850} />
    <CaptionTrack
      lines={[
        { at: OPEN + 4, words: ["This", "runner", "also", "lifts."], until: HEADLINE },
        { at: HEADLINE + 4, words: ["The", "day", "after", "leg", "day."], until: TYPE + 30 },
        { at: TYPE + 30, words: ["Recovered", "by", "day", "3."], until: END },
      ]}
    />
    <EndCard at={END} question={["See", "*yours.*"]} />
    <div style={{ display: "none" }}>{RADAR.question}</div>
  </Stage>
);
