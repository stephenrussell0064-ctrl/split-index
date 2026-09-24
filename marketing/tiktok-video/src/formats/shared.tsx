/**
 * Shared furniture for the alternative formats — a black stage with the film's
 * grade, a generic tier badge slam, a big stat line, an end-card, and a tiny
 * cue → audio mapper so every format can carry its own SFX list.
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { C, FONT, indexDisplay, microLabel } from "../theme";
import { SAFE_RECT } from "../timing";
import { AberrationDefs, Aberration, Bloom, Flash, Grain, LightStreak, Shake, SPRING_SETTLE, useImpact, Vignette } from "../fx";
import { AppStoreBadge, Wordmark } from "../components/Brand";
import { SafeZone } from "../components/SafeZone";
import { PopWord } from "../components/Captions";

export interface Cue {
  at: number;
  name: "bass-hit" | "slam" | "whoosh" | "whoosh-rev" | "whip" | "riser" | "tick" | "shimmer";
  volume?: number;
}

const CUE_FRAMES: Record<Cue["name"], number> = { "bass-hit": 30, slam: 34, whoosh: 14, "whoosh-rev": 14, whip: 6, riser: 49, tick: 3, shimmer: 80 };

export const Cues: React.FC<{ cues: Cue[] }> = ({ cues }) => (
  <>
    {cues.map((c, i) => (
      <Sequence key={i} from={c.at} durationInFrames={CUE_FRAMES[c.name]} layout="none">
        <Audio src={staticFile(`sfx/${c.name}.wav`)} volume={() => c.volume ?? 1} />
      </Sequence>
    ))}
  </>
);

export interface FormatProps {
  sfx: boolean;
  safeZone: boolean;
}

/** Black stage + grade. `exitAt` pulls everything into black for a seamless loop. */
export const Stage: React.FC<FormatProps & { cues: Cue[]; exitAt?: number; exitFrames?: number; children: React.ReactNode }> = ({
  sfx,
  safeZone,
  cues,
  exitAt,
  exitFrames = 14,
  children,
}) => {
  const frame = useCurrentFrame();
  const exit = exitAt === undefined ? 0 : interpolate(frame, [exitAt, exitAt + exitFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      <AbsoluteFill style={{ opacity: 1 - exit, scale: String(1 - exit * 0.4), filter: exit > 0 ? `blur(${exit * 24}px)` : undefined }}>{children}</AbsoluteFill>
      <Vignette strength={0.5} />
      <Grain opacity={0.08} />
      {sfx ? <Cues cues={cues} /> : null}
      {safeZone ? <SafeZone /> : null}
    </AbsoluteFill>
  );
};

/** A pill that slams into the frame. */
export const TierBadge: React.FC<{ label: string; at: number; y: number; color?: string; size?: number; hold?: number }> = ({ label, at, y, color = C.green, size = 96, hold }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - at;
  if (t < 0) return null;
  if (hold !== undefined && t > hold) return null;
  const s = spring({ frame: t, fps, config: { damping: 12, stiffness: 320, mass: 0.9 }, durationInFrames: 16 });
  const scale = interpolate(Math.min(1, s), [0, 1], [3.2, 1]) * (1 + Math.max(0, s - 1) * 0.35);
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: y, display: "flex", justifyContent: "center", pointerEvents: "none", scale: String(scale), opacity: Math.min(1, s * 2) }}>
      <div
        style={{
          fontFamily: FONT.display,
          fontWeight: 900,
          fontSize: size,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#04120a",
          background: color,
          borderRadius: 999,
          padding: `${size * 0.18}px ${size * 0.6}px ${size * 0.22}px`,
          boxShadow: `0 0 90px ${color}aa, 0 30px 80px rgba(0,0,0,0.6)`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
};

/** Impact wrapper: shake + flash + aberration at `at`. */
export const Impact: React.FC<{ at: number; color?: string; children: React.ReactNode }> = ({ at, color = "#dfffe8", children }) => {
  const impact = useImpact(at, 6, 16);
  return (
    <>
      <Shake at={at} frames={9} amplitude={22}>
        <Aberration amount={impact}>{children}</Aberration>
      </Shake>
      <Flash at={at} frames={3} peak={0.85} color={color} />
    </>
  );
};

/** One stat line: label left, value right, springing in at `at`. */
export const StatLine: React.FC<{ label: string; value: string; sub?: string; at: number; color?: string; y: number; size?: number }> = ({ label, value, sub, at, color = C.white, y, size = 56 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - at;
  if (t < 0) return null;
  const s = spring({ frame: t, fps, config: SPRING_SETTLE, durationInFrames: 18 });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_RECT.x + 30,
        width: SAFE_RECT.w - 60,
        top: y,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 24,
        opacity: Math.min(1, s * 2),
        translate: `${interpolate(s, [0, 1], [-60, 0])}px 0px`,
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        paddingBottom: 18,
      }}
    >
      <div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: size * 0.72, color: C.white }}>{label}</div>
        {sub ? <div style={{ ...microLabel(22), marginTop: 6 }}>{sub}</div> : null}
      </div>
      <div style={{ ...indexDisplay, fontSize: size, color, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
};

/** Headline block: label on top, huge number under. */
export const BigNumber: React.FC<{ label: string; value: string; at: number; y: number; color?: string; size?: number; glow?: boolean; hold?: number }> = ({ label, value, at, y, color = C.white, size = 220, glow = true, hold }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - at;
  if (t < 0) return null;
  if (hold !== undefined && t > hold) return null;
  const s = spring({ frame: t, fps, config: { damping: 14, stiffness: 240, mass: 1 }, durationInFrames: 20 });
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: y, textAlign: "center", pointerEvents: "none", opacity: Math.min(1, s * 2), scale: String(interpolate(Math.min(1, s), [0, 1], [1.8, 1])) }}>
      <div style={{ ...microLabel(28), color: color === C.white ? C.muted : color }}>{label}</div>
      <div style={{ ...indexDisplay, fontSize: size, color, marginTop: 10, filter: glow ? `drop-shadow(0 0 30px ${color}66)` : undefined }}>{value}</div>
    </div>
  );
};

/** Wordmark + Apple badge + "Free on the App Store", for the last beat of a format. */
export const EndCard: React.FC<{ at: number; question?: string[] }> = ({ at, question = ["What's", "your", "*Split*", "_Index?_"] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - at;
  if (t < 0) return null;
  const s = spring({ frame: t - 12, fps, config: SPRING_SETTLE, durationInFrames: 22 });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* black backdrop — whatever was on screen is wiped before the ask */}
      <AbsoluteFill style={{ background: C.black, opacity: interpolate(t, [0, 5], [0, 1], { extrapolateRight: "clamp" }) }} />
      <Bloom color="green" intensity={0.25} x={400} y={700} size={1000} />
      <Bloom color="blue" intensity={0.18} x={720} y={1050} size={900} />
      <LightStreak y={520} color="green" width={1500} thickness={6} opacity={0.35} />
      <div style={{ position: "absolute", left: 0, right: 140, top: 250, display: "flex", justifyContent: "center", opacity: Math.min(1, t / 8) }}>
        <Wordmark size={64} />
      </div>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 560, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 28px" }}>
        {question.map((w, i) => (
          <PopWord key={i} word={w} at={at + i * 4} size={124} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 140, top: 1080, display: "flex", justifyContent: "center", translate: `0px ${interpolate(s, [0, 1], [120, 0])}px`, opacity: Math.min(1, s * 2) }}>
        <AppStoreBadge height={136} />
      </div>
      <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 1340, display: "flex", justifyContent: "center", gap: 16, whiteSpace: "nowrap" }}>
        {["Free", "on", "the", "App", "Store"].map((w, i) => (
          <PopWord key={i} word={w} at={at + 16 + i * 3} size={54} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const ATHLETE_LINE = "Sam · male · 29 · 84 kg · demo profile";
