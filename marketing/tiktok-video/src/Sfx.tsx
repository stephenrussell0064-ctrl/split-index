/**
 * Sound design track. Rendered only when the `sfx` prop is on — the master
 * is silent so a sound can be added natively in TikTok.
 *
 * Every file is synthesised by scripts/gen-sfx.mjs (see README for licences:
 * all self-generated). Cues sit on the same constants the picture uses.
 */
import React from "react";
import { Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { SCENES, REVEAL, USP, STATUS, CTA, beat, SHORT } from "./timing";
import { tickFrames } from "./score-curve";
import { SCORE } from "./data";
import type { HookVariant } from "./hooks";
import { scheduleLines } from "./components/KineticText";

const sfx = (name: string) => staticFile(`sfx/${name}.wav`);

const Cue: React.FC<{ at: number; name: string; volume?: number; frames?: number }> = ({ at, name, volume = 1, frames = 60 }) => (
  <Sequence from={at} durationInFrames={frames} layout="none">
    <Audio src={sfx(name)} volume={volume} />
  </Sequence>
);

/** Ticks for the count-up, offset to the reveal's count start. */
const Ticks: React.FC<{ countStart: number }> = ({ countStart }) => (
  <>
    {tickFrames(SCORE.split).map((f) => (
      <Cue key={f} at={countStart + f} name="tick" volume={0.55} frames={3} />
    ))}
  </>
);

export const SfxTrack: React.FC<{ hook: HookVariant }> = ({ hook }) => {
  const h = SCENES.hook.from;
  const t = SCENES.tension.from;
  const r = SCENES.reveal.from;
  const u = SCENES.usp.from;
  const s = SCENES.status.from;
  const c = SCENES.cta.from;
  const l = SCENES.loop.from;
  // one bass hit per hook line as it starts to slam — same schedule as the picture
  const { lineStarts } = scheduleLines(hook.lines, h);

  return (
    <>
      {lineStarts.map((f, i) => (
        <Cue key={`hook-${i}`} at={f} name="bass-hit" volume={i === 0 ? 1 : 0.85} frames={30} />
      ))}
      {/* tension cuts, one whoosh per beat, alternating direction */}
      {[0, 1, 2, 3].map((i) => (
        <Cue key={`ten-${i}`} at={t + beat(i)} name={i % 2 ? "whoosh-rev" : "whoosh"} volume={0.7} frames={14} />
      ))}
      <Cue at={t + beat(4)} name="slam" volume={0.9} frames={34} />
      {/* reveal */}
      <Cue at={r} name="whip" volume={0.8} frames={6} />
      <Cue at={r + REVEAL.setLogged} name="tick" volume={0.7} frames={3} />
      <Cue at={r + REVEAL.saveTap} name="whoosh" volume={0.6} frames={14} />
      <Cue at={r + REVEAL.countEnd - 48} name="riser" volume={0.8} frames={49} />
      <Ticks countStart={r + REVEAL.countStart} />
      <Cue at={r + REVEAL.badgeSlam} name="slam" volume={1} frames={34} />
      <Cue at={r + REVEAL.subScores} name="tick" volume={0.5} frames={3} />
      {/* usp */}
      <Cue at={u} name="whoosh-rev" volume={0.7} frames={14} />
      <Cue at={u + USP.headline} name="bass-hit" volume={0.9} frames={30} />
      <Cue at={u + USP.headline + 6} name="tick" volume={0.6} frames={3} />
      {/* status */}
      <Cue at={s} name="whoosh" volume={0.7} frames={14} />
      <Cue at={s + STATUS.climbEnd - 2} name="bass-hit" volume={0.8} frames={30} />
      {/* cta */}
      <Cue at={c} name="whip" volume={0.8} frames={6} />
      <Cue at={c + CTA.question} name="shimmer" volume={0.55} frames={80} />
      <Cue at={c + CTA.badge} name="tick" volume={0.6} frames={3} />
      {/* loop out */}
      <Cue at={l} name="whoosh-rev" volume={0.8} frames={14} />
    </>
  );
};

/** The cut-down's cues. */
export const SfxTrackShort: React.FC<{ hook: HookVariant }> = ({ hook }) => {
  const r = SHORT.reveal.from;
  const c = SHORT.cta.from;
  const { lineStarts } = scheduleLines(hook.lines, 0);
  return (
    <>
      {lineStarts.map((f, i) => (
        <Cue key={`hook-${i}`} at={f} name="bass-hit" volume={i === 0 ? 1 : 0.85} frames={30} />
      ))}
      <Cue at={r} name="whip" volume={0.8} frames={6} />
      <Cue at={r + REVEAL.setLogged} name="tick" volume={0.7} frames={3} />
      <Cue at={r + REVEAL.saveTap} name="whoosh" volume={0.6} frames={14} />
      <Cue at={r + REVEAL.countEnd - 48} name="riser" volume={0.8} frames={49} />
      <Ticks countStart={r + REVEAL.countStart} />
      <Cue at={r + REVEAL.badgeSlam} name="slam" volume={1} frames={34} />
      <Cue at={c} name="whip" volume={0.8} frames={6} />
      <Cue at={c} name="shimmer" volume={0.55} frames={80} />
      <Cue at={c + beat(1) + 8} name="tick" volume={0.6} frames={3} />
    </>
  );
};
