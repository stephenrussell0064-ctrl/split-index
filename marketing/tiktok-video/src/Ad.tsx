/**
 * The film. One composition, five hooks, one body.
 *
 * Props:
 *   hook      "A" | "B" | "C" | "D" | "E"
 *   safeZone  draw the TikTok safe-zone overlay (checking only — never render it into a deliverable)
 *   sfx       include the sound-design track (master is silent)
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { z } from "zod";
import { SCENES, SHORT, dur, WHIP_FRAMES, FLASH_FRAMES, WIDTH } from "./timing";
import { HOOKS } from "./hooks";
import { HookScene } from "./scenes/Hook";
import { TensionScene } from "./scenes/Tension";
import { RevealScene } from "./scenes/Reveal";
import { UspScene } from "./scenes/Usp";
import { StatusScene } from "./scenes/Status";
import { CtaScene } from "./scenes/Cta";
import { AberrationDefs, Flash, Grain, Vignette, RAMP_OUT } from "./fx";
import { SafeZone } from "./components/SafeZone";
import { SfxTrack, SfxTrackShort } from "./Sfx";
import { C } from "./theme";

export const adSchema = z.object({
  hook: z.enum(["A", "B", "C", "D", "E"]),
  safeZone: z.boolean(),
  sfx: z.boolean(),
});
export type AdProps = z.infer<typeof adSchema>;

/** A scene whips in over its first WHIP_FRAMES with camera motion blur, then renders plain. */
export const WhipIn: React.FC<{ from: "left" | "right" | "up" | "down"; children: React.ReactNode }> = ({ from, children }) => {
  const frame = useCurrentFrame();
  if (frame >= WHIP_FRAMES) return <AbsoluteFill>{children}</AbsoluteFill>;
  const d = interpolate(frame, [0, WHIP_FRAMES], [0.7, 0], { easing: RAMP_OUT, extrapolateRight: "clamp" });
  const dx = from === "left" ? -WIDTH * d : from === "right" ? WIDTH * d : 0;
  const dy = from === "up" ? -1920 * d : from === "down" ? 1920 * d : 0;
  return (
    <CameraMotionBlur shutterAngle={200} samples={6}>
      <AbsoluteFill style={{ translate: `${dx}px ${dy}px` }}>{children}</AbsoluteFill>
    </CameraMotionBlur>
  );
};

export const Grade: React.FC<{ safeZone: boolean }> = ({ safeZone }) => (
  <>
    <Vignette strength={0.5} />
    <Grain opacity={0.08} />
    {safeZone ? <SafeZone /> : null}
  </>
);

export const Ad: React.FC<AdProps> = ({ hook, safeZone, sfx }) => {
  const h = HOOKS[hook];
  const cuts = [SCENES.tension.from, SCENES.reveal.from, SCENES.usp.from, SCENES.status.from, SCENES.cta.from];
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />

      <Sequence from={SCENES.hook.from} durationInFrames={dur(SCENES.hook)}>
        <HookScene hook={h} />
      </Sequence>

      <Sequence from={SCENES.tension.from} durationInFrames={dur(SCENES.tension)}>
        <WhipIn from="right">
          <TensionScene hook={h} />
        </WhipIn>
      </Sequence>

      <Sequence from={SCENES.reveal.from} durationInFrames={dur(SCENES.reveal)}>
        <WhipIn from="down">
          <RevealScene />
        </WhipIn>
      </Sequence>

      <Sequence from={SCENES.usp.from} durationInFrames={dur(SCENES.usp)}>
        <WhipIn from="left">
          <UspScene />
        </WhipIn>
      </Sequence>

      <Sequence from={SCENES.status.from} durationInFrames={dur(SCENES.status)}>
        <WhipIn from="up">
          <StatusScene />
        </WhipIn>
      </Sequence>

      <Sequence from={SCENES.cta.from} durationInFrames={dur(SCENES.cta) + dur(SCENES.loop)}>
        <WhipIn from="right">
          <CtaScene exitAt={dur(SCENES.cta) - 2} exitFrames={22} />
        </WhipIn>
      </Sequence>

      {cuts.map((c) => (
        <Flash key={c} at={c} frames={FLASH_FRAMES} peak={0.6} />
      ))}

      <Grade safeZone={safeZone} />
      {sfx ? <SfxTrack hook={h} /> : null}
    </AbsoluteFill>
  );
};

/** The 8 s cut-down: hook → score reveal → CTA. */
export const AdShort: React.FC<AdProps> = ({ hook, safeZone, sfx }) => {
  const h = HOOKS[hook];
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      <Sequence from={SHORT.hook.from} durationInFrames={dur(SHORT.hook)}>
        <HookScene hook={h} />
      </Sequence>
      <Sequence from={SHORT.reveal.from} durationInFrames={dur(SHORT.reveal)}>
        <WhipIn from="down">
          <RevealScene />
        </WhipIn>
      </Sequence>
      <Sequence from={SHORT.cta.from} durationInFrames={dur(SHORT.cta)}>
        <WhipIn from="right">
          <CtaScene compact exitAt={dur(SHORT.cta) - 14} exitFrames={12} />
        </WhipIn>
      </Sequence>
      <Flash at={SHORT.reveal.from} frames={FLASH_FRAMES} peak={0.6} />
      <Flash at={SHORT.cta.from} frames={FLASH_FRAMES} peak={0.6} />
      <Grade safeZone={safeZone} />
      {sfx ? <SfxTrackShort hook={h} /> : null}
    </AbsoluteFill>
  );
};
