/**
 * Showreel — the reference ad's structure, applied to Split Index.
 *
 *   near-white stage · black phone centred · real UI at 1:1 inside it ·
 *   cards cropped from real screenshots pop out of the phone and stack ·
 *   one calm sentence per beat, accent word in colour, following the VO ·
 *   app icon + Apple badge on white · dark handle card to close.
 *
 * Beat lengths come from the voiceover: each beat lasts its line plus a
 * hold (src/showreel/vo-durations.json, written by scripts/gen-vo.ts).
 */
import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { z } from "zod";
import { FPS, SAFE_RECT } from "../timing";
import { C, FONT } from "../theme";
import { Phone, SCREEN_W, SCREEN_H } from "../components/Phone";
import { AppStoreBadge } from "../components/Brand";
import { SafeZone } from "../components/SafeZone";
import { Screen } from "../real/Shots";
import type { Beat, CardSpec, ShowreelScript } from "./script";
import durations from "./vo-durations.json";

export const showreelSchema = z.object({ voice: z.boolean(), safeZone: z.boolean() });
export type ShowreelProps = z.infer<typeof showreelSchema>;

// ── palette for the light stage (the app's own light-surface tokens) ────────
const STAGE = "#f3f3f3";
const INK = "#161616";
const GREEN_TEXT = "#1f7a4d"; // --cardio-success: the green the app uses as text on light surfaces
const BLUE_TEXT = C.blueText; // --cardio-accent-text

// ── timing ──────────────────────────────────────────────────────────────────
const HOLD = 14;
const MIN_BEAT = 60;
const OUTRO_LIGHT = 96;
const OUTRO_DARK = 54;
const PHONE_X = SAFE_RECT.x + SAFE_RECT.w / 2 - 540; // centre the phone in the TikTok safe rect
const PHONE_SCALE = 0.98;
const PHONE_Y = -165;

const EASE = { damping: 18, stiffness: 140, mass: 1 } as const;

export function beatFrames(script: ShowreelScript): number[] {
  const secs = (durations as Record<string, number[]>)[script.id];
  return script.beats.map((b, i) => Math.max(MIN_BEAT, Math.ceil((secs?.[i] ?? 2.5) * FPS) + (b.hold ?? HOLD)));
}

export function showreelDuration(script: ShowreelScript): number {
  return beatFrames(script).reduce((a, b) => a + b, 0) + OUTRO_LIGHT + OUTRO_DARK;
}

// ── caption: one sentence, words arrive with the line, accent words coloured ─
const Caption: React.FC<{ text: string; voFrames: number }> = ({ text, voFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tokens = text.split(" ");
  // words land across the first ~80% of the spoken line, like the reference
  const per = (voFrames * 0.8) / Math.max(1, tokens.length);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_RECT.x + 20,
        width: SAFE_RECT.w - 40,
        top: 1372,
        textAlign: "center",
        fontFamily: FONT.body,
        fontWeight: 600,
        fontSize: 48,
        lineHeight: 1.22,
        color: INK,
        letterSpacing: "-0.01em",
      }}
    >
      {tokens.map((raw, i) => {
        const m = /^([*_]?)(.*?)([*_]?)([.,:;!?]*)$/.exec(raw) ?? [raw, "", raw, "", ""];
        const mark = m[1];
        const word = m[2];
        const punct = m[4];
        const color = mark === "*" ? GREEN_TEXT : mark === "_" ? BLUE_TEXT : INK;
        const s = spring({ frame: frame - i * per, fps, config: { damping: 14, stiffness: 200 }, durationInFrames: 14 });
        return (
          <span key={i} style={{ display: "inline-block", marginRight: "0.28em", opacity: Math.min(1, s * 1.5), translate: `0px ${(1 - Math.min(1, s)) * 14}px`, color: mark ? color : INK }}>
            {word}
            <span style={{ color: INK }}>{punct}</span>
          </span>
        );
      })}
    </div>
  );
};

// ── a card cropped from a real screenshot, popping out of the phone ─────────
const FloatCard: React.FC<{ card: CardSpec; from: [number, number] }> = ({ card, from }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = card.at ?? 12;
  const t = frame - at;
  if (t < 0) return null;
  const s = spring({ frame: t, fps, config: EASE, durationInFrames: 26 });
  const [natW, natH] = card.size ?? [1179, 2556];
  const [cx, cy, cw, ch] = card.crop;
  const k = card.width / cw;
  const h = ch * k;
  const x = interpolate(s, [0, 1], [from[0], card.x]);
  const y = interpolate(s, [0, 1], [from[1], card.y]);
  const rot = interpolate(s, [0, 1], [(card.rot ?? 0) * 4 - 6, card.rot ?? 0]);
  const scale = interpolate(s, [0, 1], [0.55, 1]);
  return (
    <div
      style={{
        position: "absolute",
        left: x - card.width / 2,
        top: y - h / 2,
        width: card.width,
        height: h,
        borderRadius: 30,
        overflow: "hidden",
        background: "#0b0b0b",
        boxShadow: "0 30px 70px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.06)",
        opacity: Math.min(1, s * 2),
        transform: `rotate(${rot}deg) scale(${scale})`,
      }}
    >
      <Img src={staticFile(card.file)} style={{ position: "absolute", left: -cx * k, top: -cy * k, width: natW * k, height: natH * k }} />
    </div>
  );
};

// ── what the phone shows for one beat ───────────────────────────────────────
const PhoneScreen: React.FC<{ beat: Beat; frames: number }> = ({ beat, frames }) => {
  const { fps } = useVideoConfig();
  if (beat.clip) {
    return (
      <div style={{ position: "absolute", inset: 0, width: SCREEN_W, height: SCREEN_H, overflow: "hidden", background: "#000" }}>
        {/* the recordings are 720×1560 — the phone screen's own aspect, so cover crops nothing */}
        <Video src={staticFile(beat.clip.src)} trimBefore={Math.round(beat.clip.from * fps)} objectFit="cover" style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 74, background: "#000" }} />
      </div>
    );
  }
  if (beat.screen) {
    const natH = beat.screen.size?.[1] ?? 2556;
    const natW = beat.screen.size?.[0] ?? 1179;
    const y = beat.screen.y ?? natH / 2;
    return <Screen src={beat.screen.file} size={beat.screen.size} focusFrom={[natW / 2, y]} focusTo={[natW / 2, beat.screen.yTo ?? y]} zoomFrom={1} zoomTo={1} frames={Math.max(30, frames - 20)} delay={10} />;
  }
  return null;
};

// ── one beat ────────────────────────────────────────────────────────────────
const BeatView: React.FC<{ beat: Beat; frames: number; voFrames: number; index: number }> = ({ beat, frames, voFrames, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cards = beat.cards ?? [];
  const ghost = beat.ghost ?? cards.length > 0;
  const firstCard = cards.length ? Math.min(...cards.map((c) => c.at ?? 12)) : 0;
  const phoneOpacity = ghost ? interpolate(frame, [firstCard, firstCard + 14], [1, 0.22], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  // a small settle on every cut, and a slow breathing float
  const settle = spring({ frame, fps, config: { damping: 16, stiffness: 120 }, durationInFrames: 30 });
  const enter = index === 0 ? spring({ frame, fps, config: { damping: 20, stiffness: 90, mass: 1.2 }, durationInFrames: 40 }) : 1;
  const floatY = Math.sin(frame / 38) * 6;
  const scale = PHONE_SCALE * (0.985 + settle * 0.015) * (index === 0 ? interpolate(enter, [0, 1], [0.8, 1]) : 1);
  const y = PHONE_Y + floatY + (index === 0 ? interpolate(enter, [0, 1], [500, 0]) : 0);
  const phoneCentre: [number, number] = [540 + PHONE_X, 960 + PHONE_Y];
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, opacity: phoneOpacity }}>
        <Phone rotateY={0} rotateX={0} rotateZ={0} scale={scale} x={PHONE_X} y={y} glow="none">
          <PhoneScreen beat={beat} frames={frames} />
        </Phone>
      </div>
      {cards.map((c, i) => (
        <FloatCard key={i} card={c} from={phoneCentre} />
      ))}
      <Caption text={beat.caption ?? beat.vo} voFrames={voFrames} />
    </AbsoluteFill>
  );
};

// ── outro: icon + name + badge on white, then the dark handle card ──────────
const OutroLight: React.FC<{ voFrames: number }> = ({ voFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame, fps, config: { damping: 14, stiffness: 160 }, durationInFrames: 26 });
  const name = spring({ frame: frame - 8, fps, config: EASE, durationInFrames: 24 });
  const badge = spring({ frame: frame - 18, fps, config: EASE, durationInFrames: 24 });
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
        <Img src={staticFile("splitindex-icon.png")} style={{ width: 300, height: 300, borderRadius: 68, boxShadow: "0 30px 70px rgba(0,0,0,0.25)", scale: String(interpolate(icon, [0, 1], [0.6, 1])), opacity: Math.min(1, icon * 2) }} />
        <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 84, color: INK, letterSpacing: "-0.03em", opacity: Math.min(1, name * 2), translate: `0px ${(1 - name) * 30}px` }}>Split Index</div>
        <div style={{ opacity: Math.min(1, badge * 2), translate: `0px ${(1 - badge) * 40}px` }}>
          <AppStoreBadge height={120} />
        </div>
      </div>
      <Caption text="Split Index. *Free* on the App Store." voFrames={voFrames} />
    </AbsoluteFill>
  );
};

const OutroDark: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: EASE, durationInFrames: 20 });
  return (
    <AbsoluteFill style={{ background: C.black, alignItems: "center" }}>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 28, opacity: Math.min(1, s * 2), scale: String(interpolate(s, [0, 1], [0.9, 1])) }}>
        <Img src={staticFile("splitindex-icon.png")} style={{ width: 220, height: 220, borderRadius: 50 }} />
        <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 64, color: C.white, letterSpacing: "-0.03em" }}>Split Index</div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 40, color: C.muted, letterSpacing: "0.04em" }}>@split.index</div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 36, color: C.white, opacity: 0.85, marginTop: 8 }}>Free on the App Store</div>
      </div>
    </AbsoluteFill>
  );
};

// ── the film ────────────────────────────────────────────────────────────────
export const makeShowreel = (script: ShowreelScript): React.FC<ShowreelProps> => {
  const frames = beatFrames(script);
  const secs = (durations as Record<string, number[]>)[script.id] ?? [];
  const starts = frames.reduce<number[]>((acc, f, i) => [...acc, (acc[i - 1] ?? 0) + (frames[i - 1] ?? 0)], []).map((_, i) => frames.slice(0, i).reduce((a, b) => a + b, 0));
  const outroAt = frames.reduce((a, b) => a + b, 0);
  const outroVoFrames = Math.ceil((secs[script.beats.length] ?? 2.5) * FPS);

  const Comp: React.FC<ShowreelProps> = ({ voice, safeZone }) => {
    const frame = useCurrentFrame();
    // cross-fade into the dark card
    const toDark = interpolate(frame, [outroAt + OUTRO_LIGHT - 8, outroAt + OUTRO_LIGHT], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <AbsoluteFill style={{ background: `radial-gradient(70% 50% at 50% 42%, #ffffff 0%, ${STAGE} 70%, #e9e9e9 100%)` }}>
        {script.beats.map((b, i) => (
          <Sequence key={i} from={starts[i]} durationInFrames={frames[i]}>
            <BeatView beat={b} frames={frames[i]} voFrames={Math.ceil((secs[i] ?? 2.5) * FPS)} index={i} />
            {voice ? <Audio src={staticFile(`vo/${script.id}/${i}.wav`)} /> : null}
          </Sequence>
        ))}
        <Sequence from={outroAt} durationInFrames={OUTRO_LIGHT + OUTRO_DARK}>
          <OutroLight voFrames={outroVoFrames} />
          {voice ? <Audio src={staticFile(`vo/${script.id}/${script.beats.length}.wav`)} /> : null}
        </Sequence>
        <AbsoluteFill style={{ background: C.black, opacity: toDark, pointerEvents: "none" }} />
        <Sequence from={outroAt + OUTRO_LIGHT} durationInFrames={OUTRO_DARK}>
          <OutroDark />
        </Sequence>
        {safeZone ? <SafeZone /> : null}
      </AbsoluteFill>
    );
  };
  Comp.displayName = `Showreel-${script.id}`;
  return Comp;
};
