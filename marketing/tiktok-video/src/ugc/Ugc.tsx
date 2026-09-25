/**
 * Renders any UgcScript. See script.ts for the shape and the look.
 */
import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video, Audio } from "@remotion/media";
import { loadFont } from "@remotion/google-fonts/Inter";
import { z } from "zod";
import type { UgcScript, UgcBeat } from "./script";
import { SAFE_RECT, FPS } from "../timing";
import { AppStoreBadge, Wordmark } from "../components/Brand";
import { SafeZone } from "../components/SafeZone";
import { C } from "../theme";

const { fontFamily: INTER } = loadFont("normal", { weights: ["700", "800"], subsets: ["latin"] });

export const ugcSchema = z.object({ sfx: z.boolean(), safeZone: z.boolean() });
export type UgcProps = z.infer<typeof ugcSchema>;

/** TikTok's own caption look: heavy sans, white, thick black outline, lowercase. */
const captionStyle = (size: number): React.CSSProperties => ({
  fontFamily: INTER,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 1.18,
  color: "#fff",
  textAlign: "center",
  WebkitTextStroke: `${Math.max(2, size * 0.09)}px #000`,
  paintOrder: "stroke fill",
  textShadow: "0 4px 18px rgba(0,0,0,0.6)",
  letterSpacing: "-0.01em",
});

/** Handheld: three incommensurate sines, a couple of pixels, slow. */
const useHandheld = (amp = 7) => {
  const f = useCurrentFrame();
  return {
    x: Math.sin(f * 0.043) * amp + Math.sin(f * 0.0173 + 1.3) * amp * 0.6,
    y: Math.cos(f * 0.037 + 0.7) * amp + Math.sin(f * 0.0211) * amp * 0.5,
    r: Math.sin(f * 0.019 + 2.1) * 0.35,
  };
};

const Bg: React.FC<{ clip?: string; from?: number; blur?: number; dim?: number; zoom?: number }> = ({ clip, from = 0, blur = 10, dim = 0.55, zoom = 1.25 }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 300], [0, 1]);
  if (!clip) return <AbsoluteFill style={{ background: C.black }} />;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.black }}>
      <AbsoluteFill style={{ scale: String(zoom + drift * 0.04), filter: `blur(${blur}px) saturate(1.1)`, transformOrigin: "50% 40%" }}>
        <Video src={staticFile(clip)} trimBefore={Math.round(from * FPS)} objectFit="cover" style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} />
    </AbsoluteFill>
  );
};

/** Words pop in one after another, then hold. */
const PopCaption: React.FC<{ text: string; size?: number; top?: number; stagger?: number; startAt?: number }> = ({ text, size = 72, top, stagger = 3, startAt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x + 20, width: SAFE_RECT.w - 40, top: top ?? SAFE_RECT.y + SAFE_RECT.h * 0.28, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.26}px` }}>
      {words.map((w, i) => {
        const at = startAt + i * stagger;
        const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 300, mass: 0.7 }, durationInFrames: 14 });
        if (frame < at) return null;
        return (
          <span key={i} style={{ ...captionStyle(size), display: "inline-block", scale: String(interpolate(Math.min(1, s), [0, 1], [0.6, 1])), opacity: Math.min(1, s * 2) }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

const SayBeat: React.FC<{ beat: Extract<UgcBeat, { kind: "say" }> }> = ({ beat }) => {
  const words = beat.text.split(" ").length;
  const size = words > 14 ? 60 : words > 9 ? 68 : 80;
  return (
    <AbsoluteFill>
      <Bg clip={beat.bg} from={beat.bgFrom} />
      <PopCaption text={beat.text} size={size} />
    </AbsoluteFill>
  );
};

const ListBeat: React.FC<{ beat: Extract<UgcBeat, { kind: "list" }> }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const per = Math.floor((beat.seconds * fps - 20) / beat.items.length);
  return (
    <AbsoluteFill>
      <Bg clip={beat.bg} from={beat.bgFrom} />
      <div style={{ position: "absolute", left: SAFE_RECT.x + 30, width: SAFE_RECT.w - 60, top: SAFE_RECT.y + 120 }}>
        <div style={{ ...captionStyle(56), textAlign: "left", opacity: Math.min(1, frame / 6) }}>{beat.title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 44 }}>
          {beat.items.map((item, i) => {
            const at = 14 + i * per;
            const s = spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 240 }, durationInFrames: 16 });
            if (frame < at) return null;
            return (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 22, opacity: Math.min(1, s * 2), translate: `${interpolate(s, [0, 1], [-40, 0])}px 0px` }}>
                <span style={{ ...captionStyle(58), color: C.green, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ ...captionStyle(58), textAlign: "left" }}>{item}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const AppBeat: React.FC<{ beat: Extract<UgcBeat, { kind: "app" }> }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = beat.zoom ?? 1;
  return (
    <AbsoluteFill style={{ background: C.black, overflow: "hidden" }}>
      {/* the real app, sharp, filling the frame; the status bar is off the top */}
      <AbsoluteFill style={{ scale: String(zoom * 1.06), transformOrigin: `50% ${beat.focusY ?? 45}%` }}>
        {beat.clip ? (
          <Video src={staticFile(beat.clip)} trimBefore={Math.round((beat.from ?? 0) * fps)} objectFit="cover" style={{ width: "100%", height: "100%" }} />
        ) : beat.screen ? (
          <Img src={staticFile(beat.screen)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `50% ${beat.focusY ?? 45}%` }} />
        ) : null}
      </AbsoluteFill>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 120, background: "linear-gradient(#000, rgba(0,0,0,0))" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 900, background: "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.92) 40%)" }} />
      <PopCaption text={beat.text} size={64} top={1130} startAt={4} />
      <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: SAFE_RECT.y + 20, ...captionStyle(26), textAlign: "left", opacity: frame > 8 ? 0.85 : 0 }}>real screen recording</div>
    </AbsoluteFill>
  );
};

const CtaBeat: React.FC<{ beat: Extract<UgcBeat, { kind: "cta" }>; disclaimer?: string }> = ({ beat, disclaimer }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 6, fps, config: { damping: 200, stiffness: 120 }, durationInFrames: 22 });
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <div style={{ position: "absolute", left: 0, right: 140, top: 520, display: "flex", justifyContent: "center", opacity: Math.min(1, frame / 8) }}>
        <Wordmark size={76} />
      </div>
      <PopCaption text={beat.text} size={64} top={700} />
      <div style={{ position: "absolute", left: 0, right: 140, top: 900, display: "flex", justifyContent: "center", translate: `0px ${interpolate(s, [0, 1], [80, 0])}px`, opacity: Math.min(1, s * 2) }}>
        <AppStoreBadge height={130} />
      </div>
      {disclaimer ? <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 1380, ...captionStyle(28), color: "rgba(255,255,255,0.75)", WebkitTextStroke: "0px" }}>{disclaimer}</div> : null}
    </AbsoluteFill>
  );
};

/** Keyboard-ish ticks as words land — the only sound; the master is silent. */
const Ticks: React.FC<{ script: UgcScript }> = ({ script }) => {
  const { fps } = useVideoConfig();
  const cues: number[] = [];
  let cursor = 0;
  for (const b of script.beats) {
    const n = Math.round(b.seconds * fps);
    if (b.kind === "say") for (let i = 0; i < Math.min(6, b.text.split(" ").length); i++) cues.push(cursor + i * 3);
    if (b.kind === "list") for (let i = 0; i < b.items.length; i++) cues.push(cursor + 14 + i * Math.floor((n - 20) / b.items.length));
    if (b.kind === "app" || b.kind === "cta") cues.push(cursor);
    cursor += n;
  }
  return (
    <>
      {cues.map((f, i) => (
        <Sequence key={i} from={f} durationInFrames={3} layout="none">
          <Audio src={staticFile("sfx/tick.wav")} volume={() => 0.35} />
        </Sequence>
      ))}
    </>
  );
};

export const makeUgc = (script: UgcScript): React.FC<UgcProps> => {
  const Comp: React.FC<UgcProps> = ({ sfx, safeZone }) => {
    const { fps } = useVideoConfig();
    const hand = useHandheld();
    let cursor = 0;
    const placed = script.beats.map((b) => {
      const from = cursor;
      const n = Math.round(b.seconds * fps);
      cursor += n;
      return { b, from, n };
    });
    return (
      <AbsoluteFill style={{ background: C.black }}>
        <AbsoluteFill style={{ translate: `${hand.x}px ${hand.y}px`, rotate: `${hand.r}deg`, scale: "1.02" }}>
          {placed.map(({ b, from, n }, i) => (
            <Sequence key={i} from={from} durationInFrames={n}>
              {b.kind === "say" ? <SayBeat beat={b} /> : b.kind === "list" ? <ListBeat beat={b} /> : b.kind === "app" ? <AppBeat beat={b} /> : <CtaBeat beat={b} disclaimer={script.disclaimer} />}
            </Sequence>
          ))}
        </AbsoluteFill>
        {sfx ? <Ticks script={script} /> : null}
        {safeZone ? <SafeZone /> : null}
      </AbsoluteFill>
    );
  };
  Comp.displayName = `Ugc-${script.id}`;
  return Comp;
};
