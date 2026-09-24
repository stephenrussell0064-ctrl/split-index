/**
 * FORMAT · Guess the tier — three questions, each answered by the engine.
 * The pause before every answer is the comment bait. 14 s.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage, TierBadge, Impact, BigNumber, EndCard, ATHLETE_LINE, type Cue, type FormatProps } from "./shared";
import { KineticText } from "../components/KineticText";
import { CaptionTrack } from "../components/Captions";
import { Odometer } from "../components/Odometer";
import { Bloom, LightStreak } from "../fx";
import { C, FONT, microLabel } from "../theme";
import { SAFE_RECT, beat } from "../timing";
import { DEMO, SCORE } from "../data";
import { scoreAt } from "../score-curve";

export const QUIZ_DURATION = beat(28); // 14 s

const Q1 = beat(0);
const A1 = beat(4);
const Q2 = beat(6);
const A2 = beat(10);
const Q3 = beat(12);
const COUNT = beat(14);
const A3 = beat(18);
const END = beat(21);

export const QUIZ_CUES: Cue[] = [
  { at: Q1, name: "bass-hit", volume: 0.8 },
  { at: A1, name: "slam" },
  { at: Q2, name: "whoosh", volume: 0.7 },
  { at: A2, name: "slam" },
  { at: Q3, name: "whoosh-rev", volume: 0.7 },
  { at: COUNT, name: "riser", volume: 0.8 },
  { at: A3, name: "slam" },
  { at: END, name: "whoosh" },
  { at: END, name: "shimmer", volume: 0.5 },
];

const QMark: React.FC<{ from: number; to: number; y: number }> = ({ from, to, y }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const pulse = 1 + 0.08 * Math.sin((frame - from) * 0.5);
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: y, textAlign: "center", fontFamily: FONT.display, fontWeight: 900, fontSize: 260, color: "rgba(250,250,250,0.18)", scale: String(pulse), lineHeight: 1 }}>?</div>
  );
};

const Question: React.FC<{ from: number; to: number; kicker: string; lines: string[][] }> = ({ from, to, kicker, lines }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const out = interpolate(frame, [to - 5, to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 230, textAlign: "center", ...microLabel(28), color: C.muted }}>{kicker}</div>
      <KineticText lines={lines} at={from} budget={18} size={112} vAlign="top" inset={140} />
    </AbsoluteFill>
  );
};

const Count: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < COUNT || frame >= END) return null;
  const v = scoreAt(frame - COUNT, SCORE.split);
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 620, display: "flex", justifyContent: "center", filter: `drop-shadow(0 0 ${20 + (v / SCORE.split) * 40}px rgba(250,250,250,0.5))` }}>
      <Odometer value={v} size={260} />
    </div>
  );
};

export const Quiz: React.FC<FormatProps> = (p) => (
  <Stage {...p} cues={QUIZ_CUES} exitAt={QUIZ_DURATION - 14}>
    <Bloom color="green" intensity={0.2} x={400} y={800} size={1100} />
    <LightStreak y={300} color="blue" width={1500} thickness={5} opacity={0.3} />
    <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: 190, ...microLabel(22), color: "rgba(250,250,250,0.45)" }}>{ATHLETE_LINE}</div>

    {/* Q1 */}
    <Question from={Q1} to={Q2} kicker="Guess the tier" lines={[["Bench"], [`*${DEMO.loggedSet.weightKg} kg*`, "×", `${DEMO.loggedSet.reps}`], ["at", `${DEMO.athlete.bodyweightKg} kg`, "bodyweight"]]} />
    <QMark from={Q1 + 20} to={A1} y={900} />
    <Impact at={A1}>
      <BigNumber label="Bench score" value={DEMO.loggedSet.liftScoreDisplay} at={A1} y={880} size={200} color={C.green} hold={Q2 - A1} />
      {A1 < Q2 ? <TierBadge label={DEMO.loggedSet.liftTier} at={A1 + 6} y={1160} size={80} hold={Q2 - A1 - 6} /> : null}
    </Impact>

    {/* Q2 */}
    <Question from={Q2} to={Q3} kicker="Guess the tier" lines={[["5k"], [`_${DEMO.fiveK.timeLabel}_`], [DEMO.fiveK.paceLabel]]} />
    <QMark from={Q2 + 20} to={A2} y={900} />
    {A2 < Q3 ? (
      <Impact at={A2}>
        <BigNumber label="5k score" value={DEMO.fiveK.scoreDisplay} at={A2} y={880} size={200} color={C.blue} hold={Q3 - A2} />
        <TierBadge label={DEMO.fiveK.tier} at={A2 + 6} y={1160} size={80} color={C.blue} hold={Q3 - A2 - 6} />
      </Impact>
    ) : null}

    {/* Q3 */}
    <Question from={Q3} to={END} kicker="Both together" lines={[["Split", "Index?"]]} />
    <Count />
    <Impact at={A3}>
      <TierBadge label={SCORE.splitTier} at={A3} y={960} size={84} hold={END - A3} />
    </Impact>

    <CaptionTrack
      lines={[
        { at: Q1 + 24, words: ["Drop", "your", "guess", "👇"], until: A1 },
        { at: Q2 + 24, words: ["Harsher", "than", "you", "think?"], until: A2 },
        { at: COUNT, words: ["Strength", "+", "endurance."], until: A3 },
        { at: A3 + 2, words: ["Out", "of", "100."], until: END },
      ]}
    />
    <EndCard at={END} />
  </Stage>
);

