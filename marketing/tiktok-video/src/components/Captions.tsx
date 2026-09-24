/**
 * Burned-in captions, TikTok pop style: each word springs in, bold, high
 * contrast, in a fixed slot just above the safe-zone floor. A caption is at
 * most five words (enforced at the type level by the callers keeping lines
 * short, and at runtime by a console warning in Studio).
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { SAFE } from "../timing";
import { SPRING_POP } from "../fx";
import { parseWord } from "./KineticText";

export const CAPTION_SIZE = 64;
/** Baseline of the caption block, measured from the top of frame. Ends above the TikTok floor. */
export const CAPTION_BOTTOM = 1920 - SAFE.bottom - 48; // 1452

export interface CaptionLine {
  /** Frame the first word pops. */
  at: number;
  words: string[];
  /** Frames between word pops. */
  stagger?: number;
  /** Frame the caption leaves. Defaults to the next caption's `at`. */
  until?: number;
  /** Highlight colour for words wrapped like *this* */
  accent?: "green" | "blue";
  /** Dark caption for light backgrounds. */
  onLight?: boolean;
}

export const PopWord: React.FC<{
  word: string;
  at: number;
  accent?: "green" | "blue";
  size?: number;
  onLight?: boolean;
  font?: string;
  weight?: number;
}> = ({ word, at, accent, size = CAPTION_SIZE, onLight, font = FONT.display, weight = 900 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: SPRING_POP, durationInFrames: 18 });
  const scale = interpolate(s, [0, 1], [0.4, 1]);
  const parsed = parseWord(word);
  const text = parsed.text;
  const isAccent = parsed.color !== C.white;
  const color = isAccent ? parsed.color : onLight ? C.engineText : C.white;
  void accent;
  if (frame < at) return null;
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1.05,
        color,
        scale: String(scale),
        opacity: Math.min(1, s * 1.6),
        textShadow: onLight ? "none" : "0 3px 0 rgba(0,0,0,0.9), 0 0 32px rgba(0,0,0,0.9)",
        WebkitTextStroke: onLight ? "0px" : "1.5px rgba(0,0,0,0.35)",
        letterSpacing: "-0.01em",
      }}
    >
      {text}
    </span>
  );
};

export const Caption: React.FC<CaptionLine & { size?: number }> = ({
  at,
  words,
  stagger = 4,
  until,
  accent = "green",
  onLight,
  size = CAPTION_SIZE,
}) => {
  const frame = useCurrentFrame();
  if (words.length > 5 && typeof console !== "undefined") {
    console.warn(`Caption over five words: "${words.join(" ")}"`);
  }
  if (frame < at) return null;
  if (until !== undefined && frame >= until) return null;
  const leaving = until !== undefined ? interpolate(frame, [until - 4, until], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: SAFE.left + 20,
          right: SAFE.right + 20,
          bottom: 1920 - CAPTION_BOTTOM,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: `0px ${Math.round(size * 0.28)}px`,
          textAlign: "center",
          opacity: leaving,
        }}
      >
        {words.map((w, i) => (
          <PopWord key={`${w}-${i}`} word={w} at={at + i * stagger} accent={accent} size={size} onLight={onLight} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** A caption track: each line lasts until the next begins. */
export const CaptionTrack: React.FC<{ lines: CaptionLine[] }> = ({ lines }) => (
  <>
    {lines.map((l, i) => (
      <Caption key={i} {...l} until={l.until ?? lines[i + 1]?.at} />
    ))}
  </>
);
