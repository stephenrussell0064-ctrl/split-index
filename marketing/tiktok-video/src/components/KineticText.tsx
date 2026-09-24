/**
 * The hook: huge display type slamming in word by word. Motion starts on
 * frame 1 (the first word's spring is already moving at frame 1), no fade-in.
 * Each word carries a short motion-blur trail while it is still travelling.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Trail } from "@remotion/motion-blur";
import { C, FONT } from "../theme";
import { SAFE_RECT } from "../timing";
import { SPRING_SLAM } from "../fx";

export const parseWord = (raw: string): { text: string; color: string } => {
  if (raw.startsWith("*") && raw.endsWith("*")) return { text: raw.slice(1, -1), color: C.green };
  if (raw.startsWith("_") && raw.endsWith("_")) return { text: raw.slice(1, -1), color: C.blue };
  return { text: raw, color: C.white };
};

/**
 * Fits any number of words into `budget` frames: the stagger shrinks as the
 * hook gets longer, so a two-line hook and a three-line hook both land inside
 * the 1.5 s HOOK beat. Shared with the SFX track so bass hits sit on lines.
 */
export const scheduleLines = (lines: string[][], at = 0, budget = 40, lineGap = 3, maxStagger = 5) => {
  const words = lines.reduce((n, l) => n + l.length, 0);
  const stagger = Math.max(2, Math.min(maxStagger, Math.floor((budget - (lines.length - 1) * lineGap) / words)));
  let cursor = at;
  const lineStarts: number[] = [];
  const starts = lines.map((line) => {
    lineStarts.push(cursor);
    const s = line.map((_, i) => cursor + i * stagger);
    cursor += line.length * stagger + lineGap;
    return s;
  });
  return { stagger, starts, lineStarts, end: cursor - lineGap };
};

const SlamWord: React.FC<{ raw: string; at: number; size: number }> = ({ raw, at, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { text, color } = parseWord(raw);
  const t = frame - at;
  if (t < 0) return null;
  const s = spring({ frame: t, fps, config: SPRING_SLAM, durationInFrames: 16 });
  const scale = interpolate(Math.min(1, s), [0, 1], [2.8, 1]) * (1 + Math.max(0, s - 1) * 0.4);
  const blur = Math.max(0, interpolate(s, [0, 1], [22, 0]));
  const opacity = interpolate(s, [0, 0.35, 1], [0, 1, 1]);
  const moving = t < 9;

  const word = (
    <span
      style={{
        display: "inline-block",
        fontFamily: FONT.display,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        color,
        scale: String(scale),
        filter: `blur(${blur}px)`,
        opacity,
        textShadow: color === C.white ? "0 0 40px rgba(255,255,255,0.18)" : `0 0 48px ${color}88`,
        willChange: "transform",
      }}
    >
      {text}
    </span>
  );

  return moving ? (
    <span style={{ display: "inline-block", position: "relative" }}>
      <Trail layers={3} lagInFrames={0.6} trailOpacity={0.45}>
        {word}
      </Trail>
    </span>
  ) : (
    word
  );
};

export interface KineticTextProps {
  lines: string[][];
  /** Frame the first word lands. */
  at?: number;
  /** Frames the whole block must land within. */
  budget?: number;
  size?: number;
  /** Where the block sits vertically: "top" | "center" | "bottom". */
  vAlign?: "top" | "center" | "bottom";
  /** Vertical inset in px from the safe rect edges. */
  inset?: number;
}

export const KineticText: React.FC<KineticTextProps> = ({ lines, at = 0, budget = 40, size = 132, vAlign = "center", inset = 40 }) => {
  const { starts } = scheduleLines(lines, at, budget);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: SAFE_RECT.x,
          width: SAFE_RECT.w,
          top: SAFE_RECT.y,
          height: SAFE_RECT.h,
          display: "flex",
          flexDirection: "column",
          justifyContent: vAlign === "top" ? "flex-start" : vAlign === "bottom" ? "flex-end" : "center",
          alignItems: "center",
          gap: Math.round(size * 0.18),
          padding: `${inset}px 0`,
          boxSizing: "border-box",
        }}
      >
        {lines.map((line, li) => (
          <div
            key={li}
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: `0 ${Math.round(size * 0.22)}px`,
              textAlign: "center",
              maxWidth: SAFE_RECT.w,
            }}
          >
            {line.map((w, wi) => (
              <SlamWord key={`${li}-${wi}`} raw={w} at={starts[li][wi]} size={size} />
            ))}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
