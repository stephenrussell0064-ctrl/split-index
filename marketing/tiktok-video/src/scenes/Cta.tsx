/**
 * CTA · 18–21 s, then LOOP · 21–22 s.
 * "What's your Split Index?" → Apple's badge → "Free on the App Store".
 * In the loop tail everything is pulled into the centre and swallowed by
 * black, so the final frame matches frame 0 (black + grain) and the video
 * loops without a seam.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { AppStoreBadge, Wordmark } from "../components/Brand";
import { CaptionTrack } from "../components/Captions";
import { Bloom, LightStreak, RAMP_IN, SPRING_SETTLE } from "../fx";
import { CTA } from "../timing";
import { C } from "../theme";

export const CtaScene: React.FC<{
  /** Frame at which the loop-out begins (relative to scene). Omit for none. */
  exitAt?: number;
  exitFrames?: number;
  /** Compact timings for the cut-down. */
  compact?: boolean;
}> = ({ exitAt, exitFrames = 18, compact }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badgeAt = compact ? 15 : CTA.badge;
  const freeAt = compact ? 30 : CTA.free;

  const badge = spring({ frame: frame - badgeAt, fps, config: SPRING_SETTLE, durationInFrames: 24 });
  const exit = exitAt === undefined ? 0 : interpolate(frame, [exitAt, exitAt + exitFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: RAMP_IN });

  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Bloom color="green" intensity={0.3 * (1 - exit)} x={380} y={700} size={1000} />
      <Bloom color="blue" intensity={0.22 * (1 - exit)} x={760} y={1000} size={900} />
      <LightStreak y={520} color="green" width={1600} thickness={7} opacity={0.4 * (1 - exit)} drift={260} progress={frame / 90} />
      <LightStreak y={1180} color="blue" width={1400} thickness={5} opacity={0.3 * (1 - exit)} drift={-220} progress={frame / 90} />

      <AbsoluteFill style={{ scale: String(1 - exit * 0.7), opacity: 1 - exit, filter: `blur(${exit * 30}px)` }}>
        <div style={{ position: "absolute", left: 0, right: 140, top: 250, display: "flex", justifyContent: "center", opacity: Math.min(1, frame / 8) }}>
          <Wordmark size={64} />
        </div>
        <KineticText lines={[["What's", "your"], ["*Split*", "_Index?_"]]} size={128} budget={compact ? 18 : 24} />
        {frame >= badgeAt ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 140,
              top: 1120,
              display: "flex",
              justifyContent: "center",
              translate: `0px ${interpolate(badge, [0, 1], [120, 0])}px`,
              opacity: Math.min(1, badge * 2),
            }}
          >
            <AppStoreBadge height={136} />
          </div>
        ) : null}
      </AbsoluteFill>

      <AbsoluteFill style={{ opacity: 1 - exit }}>
        <CaptionTrack lines={[{ at: freeAt, words: ["Free", "on", "the", "App", "Store"], stagger: 3 }]} />
      </AbsoluteFill>

      {/* black swallows the frame; grain is layered above this in Ad.tsx so the last frame == frame 0 */}
      <AbsoluteFill style={{ background: C.black, opacity: exit }} />
    </AbsoluteFill>
  );
};
