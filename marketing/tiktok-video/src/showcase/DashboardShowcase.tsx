/**
 * SHOWCASE · the dashboard and the race predictions. 20 s.
 *
 * Built on what the 26 Sep analytics read said works: a real screen and a
 * real number in frame 1, then the app's own features held long enough to
 * read. Every frame inside the phone is an unedited screenshot of the real
 * account; captions quote only what is on screen beneath them.
 *
 *   0–2.5 s   the real dashboard, 75.9 Advanced, camera pushes in
 *   2.5–5.5   Engine 70.1 · Lab 81.7 — running and lifting, one score
 *   5.5–10    predicted race times: 5k 18:52 · 10k 40:17 · half 1:31:09 · full 3:14:35
 *   10–13     race records: actual 5k 18:25, 10k 49:39
 *   13–16     predicted 1RM: squat 124 · bench 133 · deadlift 200
 *   16–20     CTA, loop-out to black
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { beat, FLASH_FRAMES, SAFE_RECT } from "../timing";
import { WhipIn, Grade } from "../Ad";
import { CtaScene } from "../scenes/Cta";
import { Phone } from "../components/Phone";
import { CaptionTrack } from "../components/Captions";
import { AberrationDefs, Aberration, Bloom, Flash, LightStreak, Shake, useImpact, SPRING_CAMERA } from "../fx";
import { C, microLabel } from "../theme";
import { REAL } from "../real/data";
import { Screen } from "../real/Shots";
import { Cues, type Cue } from "../formats/shared";

export const showcaseSchema = z.object({ sfx: z.boolean(), safeZone: z.boolean() });

// ── beat map ────────────────────────────────────────────────────────────────
export const SHOWCASE = {
  open: beat(0),
  sides: beat(5),
  races: beat(11),
  records: beat(20),
  oneRm: beat(26),
  cta: beat(32),
  end: beat(40),
} as const;
export const SHOWCASE_DURATION = SHOWCASE.end;

const SAFE_DX = SAFE_RECT.x + SAFE_RECT.w / 2 - 540;

const Provenance: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: 205, ...microLabel(22), color: "rgba(250,250,250,0.5)", pointerEvents: "none" }}>{text}</div>
);

export const SHOWCASE_CUES: Cue[] = [
  { at: SHOWCASE.open, name: "bass-hit" },
  { at: SHOWCASE.open + 12, name: "tick", volume: 0.6 },
  { at: SHOWCASE.sides, name: "whoosh", volume: 0.7 },
  { at: SHOWCASE.races - 20, name: "riser", volume: 0.6 },
  { at: SHOWCASE.races, name: "slam" },
  ...[0, 1, 2, 3].map((i) => ({ at: SHOWCASE.races + 30 + i * 12, name: "tick" as const, volume: 0.6 })),
  { at: SHOWCASE.records, name: "whoosh-rev", volume: 0.7 },
  { at: SHOWCASE.records + 24, name: "tick", volume: 0.6 },
  { at: SHOWCASE.oneRm, name: "whoosh", volume: 0.7 },
  ...[0, 1, 2].map((i) => ({ at: SHOWCASE.oneRm + 30 + i * 12, name: "tick" as const, volume: 0.6 })),
  { at: SHOWCASE.cta, name: "bass-hit" },
  { at: SHOWCASE.cta, name: "shimmer", volume: 0.5 },
  { at: SHOWCASE.end - 22, name: "whoosh-rev", volume: 0.7 },
];

// ── the dashboard, three moves on one screenshot ───────────────────────────
const DashboardShot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const S = SHOWCASE;
  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 34 });
  const rotateY = interpolate(enter, [0, 1], [30, 10]);
  const rotateX = interpolate(enter, [0, 1], [10, 4]);
  const rotateZ = interpolate(enter, [0, 1], [-6, -2]);
  const scale = interpolate(enter, [0, 1], [0.95, 1.2]);
  const y = interpolate(enter, [0, 1], [500, 60]);
  const impact = useImpact(S.races, 6, 16);
  const glow = interpolate(frame, [S.races - 20, S.races], [0.3, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // one Screen per move so each has its own start
  const screen =
    frame < S.sides ? (
      <Screen src={REAL.dashboard.file} focusFrom={[590, 640]} focusTo={[590, 660]} zoomFrom={1.25} zoomTo={1.35} frames={S.sides} />
    ) : frame < S.races ? (
      <Sequence from={S.sides} layout="none">
        <Screen src={REAL.dashboard.file} focusFrom={[590, 660]} focusTo={[590, 900]} zoomFrom={1.35} zoomTo={1.3} frames={40} />
      </Sequence>
    ) : (
      <Sequence from={S.races} layout="none">
        <Screen src={REAL.dashboard.file} focusFrom={[590, 900]} focusTo={[590, 1230]} zoomFrom={1.3} zoomTo={1.42} frames={26} />
      </Sequence>
    );

  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Bloom color="green" intensity={0.15 + glow * 0.4} x={540 + SAFE_DX} y={760} size={1100} />
      <Bloom color="blue" intensity={0.1 + glow * 0.25} x={540 + SAFE_DX} y={1400} size={900} />
      <LightStreak y={560} color="green" width={1600} thickness={7} opacity={0.25 + glow * 0.4} drift={200} progress={frame / 300} />
      <LightStreak y={1240} color="blue" width={1300} thickness={5} opacity={0.2 + glow * 0.3} drift={-160} progress={frame / 300} />
      <Shake at={S.races} frames={8} amplitude={18}>
        <Aberration amount={impact}>
          <Phone rotateX={rotateX} rotateY={rotateY} rotateZ={rotateZ} scale={scale} x={SAFE_DX} y={y}>
            {screen}
          </Phone>
        </Aberration>
      </Shake>
      <Flash at={S.sides} frames={2} peak={0.5} />
      <Flash at={S.races} frames={3} peak={0.9} color="#dfffe8" />
      <Provenance text={`@${REAL.handle} · real account · 22 Sep 2026`} />
      <CaptionTrack
        lines={[
          { at: 6, words: ["My", "Split", "Index:"] },
          { at: 22, words: [`*${REAL.dashboard.splitIndex}.*`, `${REAL.dashboard.tier}.`] },
          { at: S.sides + 4, words: ["Running", `_${REAL.dashboard.engine}._`, "Lifting", `*${REAL.dashboard.lab}.*`] },
          { at: S.sides + 44, words: ["One", "score", "for", "both."] },
          { at: S.races + 4, words: ["It", "predicts", "my", "*races*"] },
          { at: S.races + 30, words: ["from", "the", "runs", "I", "log:"] },
          { at: S.races + 60, words: ["5k", `_${REAL.dashboard.predicted.fiveK}._`, "10k", `_${REAL.dashboard.predicted.tenK}._`] },
          { at: S.races + 96, words: ["Half", `_${REAL.dashboard.predicted.half}._`, "Full", `_${REAL.dashboard.predicted.full}._`] },
        ]}
      />
    </AbsoluteFill>
  );
};

// ── race records ────────────────────────────────────────────────────────────
const RecordsShot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 30 });
  const rotateY = interpolate(enter, [0, 1], [-28, -8]);
  const y = interpolate(enter, [0, 1], [400, 60]);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Bloom color="blue" intensity={0.3} x={540 + SAFE_DX} y={800} size={1100} />
      <LightStreak y={300} color="blue" width={1500} thickness={6} opacity={0.3} drift={260} progress={frame / 120} />
      <Phone rotateY={rotateY} rotateX={4} rotateZ={2} scale={1.24} x={SAFE_DX} y={y} glow="blue">
        <Screen src={REAL.records.file} focusFrom={[590, 560]} focusTo={[590, 700]} zoomFrom={1.5} zoomTo={1.35} frames={70} />
      </Phone>
      <Provenance text={`@${REAL.handle} · race records`} />
      <CaptionTrack
        lines={[
          { at: 4, words: ["And", "my", "actual", "records."] },
          { at: 34, words: ["5k", `_${REAL.records.fiveK}._`, "10k", `_${REAL.records.tenK}._`] },
          { at: 64, words: ["Predicted", "vs", "raced,", "side", "by", "side."] },
        ]}
      />
    </AbsoluteFill>
  );
};

// ── predicted 1RM ───────────────────────────────────────────────────────────
const OneRmShot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 30 });
  const rotateY = interpolate(enter, [0, 1], [24, 8]);
  const y = interpolate(enter, [0, 1], [400, 60]);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Bloom color="green" intensity={0.3} x={540 + SAFE_DX} y={800} size={1100} />
      <LightStreak y={300} color="green" width={1500} thickness={6} opacity={0.3} drift={-260} progress={frame / 120} />
      <Phone rotateY={rotateY} rotateX={4} rotateZ={-2} scale={1.24} x={SAFE_DX} y={y}>
        <Screen src={REAL.dashboard.file} focusFrom={[590, 1400]} focusTo={[590, 1480]} zoomFrom={1.3} zoomTo={1.4} frames={70} />
      </Phone>
      <Provenance text={`@${REAL.handle} · predicted 1RM`} />
      <CaptionTrack
        lines={[
          { at: 4, words: ["Same", "for", "the", "gym."] },
          { at: 30, words: ["Predicted", "1RM", "from", "my", "sets:"] },
          { at: 60, words: ["Bench", `*${REAL.dashboard.oneRM.bench}.*`, "Deadlift", `*${REAL.dashboard.oneRM.deadlift}.*`] },
        ]}
      />
    </AbsoluteFill>
  );
};

// ── the film ────────────────────────────────────────────────────────────────
export const DashboardShowcase: React.FC<z.infer<typeof showcaseSchema>> = ({ sfx, safeZone }) => {
  const S = SHOWCASE;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      <Sequence from={S.open} durationInFrames={S.records - S.open}>
        <DashboardShot />
      </Sequence>
      <Sequence from={S.records} durationInFrames={S.oneRm - S.records}>
        <WhipIn from="left">
          <RecordsShot />
        </WhipIn>
      </Sequence>
      <Sequence from={S.oneRm} durationInFrames={S.cta - S.oneRm}>
        <WhipIn from="right">
          <OneRmShot />
        </WhipIn>
      </Sequence>
      <Sequence from={S.cta} durationInFrames={S.end - S.cta}>
        <WhipIn from="down">
          <CtaScene exitAt={S.end - S.cta - 24} exitFrames={22} />
        </WhipIn>
      </Sequence>
      {[S.records, S.oneRm, S.cta].map((c) => (
        <Flash key={c} at={c} frames={FLASH_FRAMES} peak={0.6} />
      ))}
      <Grade safeZone={safeZone} />
      {sfx ? <Cues cues={SHOWCASE_CUES} /> : null}
    </AbsoluteFill>
  );
};
