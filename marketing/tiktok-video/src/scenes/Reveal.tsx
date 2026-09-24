/**
 * REVEAL · 4–9 s. The phone flies in on a 3D tilt, a set gets logged, Save,
 * riser, and the Split Index counts up from 0 on odometer wheels with a glow
 * bloom while the camera pushes in. The tier badge slams with shake + flash.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Phone } from "../components/Phone";
import { LogSetScreen, DashboardScreen } from "../components/AppScreens";
import { Aberration, Bloom, Defocus, Flash, LightStreak, Shake, useImpact, SPRING_CAMERA } from "../fx";
import { CaptionTrack } from "../components/Captions";
import { REVEAL, SAFE_RECT } from "../timing";
import { scoreAt, countProgress } from "../score-curve";
import { SCORE } from "../data";
import { C, FONT } from "../theme";

const TierSlam: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - at;
  if (t < 0 || t > 34) return null;
  const s = spring({ frame: t, fps, config: { damping: 12, stiffness: 320, mass: 0.9 }, durationInFrames: 16 });
  const out = interpolate(t, [22, 34], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_RECT.x,
        width: SAFE_RECT.w,
        top: 1000,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        scale: String(interpolate(Math.min(1, s), [0, 1], [3.4, 1]) * (1 + Math.max(0, s - 1) * 0.35) * interpolate(out, [0, 1], [0.6, 1])),
        opacity: Math.min(1, s * 2) * out,
        translate: `0px ${interpolate(out, [0, 1], [-180, 0])}px`,
      }}
    >
      <div
        style={{
          fontFamily: FONT.display,
          fontWeight: 900,
          fontSize: 104,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#04120a",
          background: C.green,
          borderRadius: 999,
          padding: "18px 64px 22px",
          boxShadow: "0 0 90px rgba(61,255,110,0.7), 0 30px 80px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap",
        }}
      >
        {SCORE.splitTier}
      </div>
    </div>
  );
};

/** Horizontal centre of the safe rect, relative to the frame centre. */
const SAFE_DX = SAFE_RECT.x + SAFE_RECT.w / 2 - 540; // -50

export const RevealScene: React.FC<{ coverMode?: boolean; captions?: boolean }> = ({ coverMode, captions = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── camera ────────────────────────────────────────────────────────────
  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 40 });
  const push = spring({ frame: frame - REVEAL.countStart, fps, config: { damping: 60, stiffness: 30, mass: 1.6 }, durationInFrames: REVEAL.countEnd - REVEAL.countStart + 20 });

  let rotateY = interpolate(enter, [0, 1], [42, 16]) * (1 - push) + 0 * push;
  let rotateX = interpolate(enter, [0, 1], [14, 7]) * (1 - push);
  let rotateZ = interpolate(enter, [0, 1], [-8, -3]) * (1 - push);
  let scale = interpolate(enter, [0, 1], [0.9, 1.15]) * (1 - push) + 1.46 * push;
  const lift = spring({ frame: frame - REVEAL.subScores, fps, config: SPRING_CAMERA, durationInFrames: 30 });
  let y = interpolate(enter, [0, 1], [900, 10]) * (1 - push) + (210 - 120 * lift) * push;

  if (coverMode) {
    rotateY = 12;
    rotateX = 5;
    rotateZ = -2;
    scale = 1.1;
    y = 360;
  }

  // ── screens ───────────────────────────────────────────────────────────
  const swapAt = REVEAL.saveTap + 9;
  const onDashboard = frame >= swapAt;
  const value = frame >= REVEAL.countStart ? scoreAt(frame - REVEAL.countStart, SCORE.split) : 0;
  const cp = frame >= REVEAL.countStart ? countProgress(frame - REVEAL.countStart) : 0;
  const badgePulse = interpolate(frame, [REVEAL.badgeSlam, REVEAL.badgeSlam + 3, REVEAL.badgeSlam + 30], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const glow = Math.min(1, cp * 0.8 + badgePulse * 0.6);

  const impact = useImpact(REVEAL.badgeSlam, 6, 18);

  const screen = onDashboard ? (
    <DashboardScreen value={coverMode ? SCORE.split : value} badgeAt={REVEAL.badgeSlam} subAt={REVEAL.subScores} glow={coverMode ? 0.8 : glow} />
  ) : (
    <LogSetScreen setAt={REVEAL.setLogged} scoreAt={REVEAL.setLogged + 14} saveAt={REVEAL.saveTap} />
  );

  const captionLines = [
    { at: REVEAL.setLogged, words: ["Log", "a", "set."] },
    { at: REVEAL.countStart, words: ["One", "score."] },
    { at: REVEAL.countStart + 30, words: ["Out", "of", "100."] },
    { at: REVEAL.badgeSlam + 2, words: [`*${SCORE.splitTier}.*`] },
    { at: REVEAL.subScores + 6, words: ["Strength", `*${SCORE.lab}.*`, "Endurance", `_${SCORE.engine}._`] },
  ];

  return (
    <AbsoluteFill style={{ background: C.black }}>
      {/* depth: defocused bloom and streaks behind the phone */}
      <Defocus blur={30} opacity={0.9}>
        <Bloom color="green" intensity={0.25 + glow * 0.6} x={540 + SAFE_DX} y={760} size={1100} />
        <Bloom color="blue" intensity={0.12 + glow * 0.2} x={540 + SAFE_DX} y={1500} size={900} />
      </Defocus>
      <LightStreak y={560} color="green" width={1600} thickness={8} opacity={0.35 + glow * 0.5} drift={200} progress={cp} />
      <LightStreak y={1240} color="blue" width={1300} thickness={5} opacity={0.2 + glow * 0.3} drift={-160} progress={cp} />

      <Shake at={REVEAL.badgeSlam} frames={10} amplitude={24}>
        <Aberration amount={impact}>
          <Phone rotateX={rotateX} rotateY={rotateY} rotateZ={rotateZ} scale={scale} x={SAFE_DX} y={y} glow={onDashboard ? "green" : "green"}>
            {screen}
            {/* screen flash on the swap */}
            {frame >= swapAt && frame < swapAt + 4 ? <AbsoluteFill style={{ background: C.white, opacity: interpolate(frame, [swapAt, swapAt + 4], [0.9, 0]) }} /> : null}
          </Phone>
        </Aberration>
      </Shake>

      {/* the tier, slammed across the frame, then handed to the pill on the phone */}
      {!coverMode ? <TierSlam at={REVEAL.badgeSlam} /> : null}

      <Flash at={swapAt} frames={2} peak={0.5} />
      <Flash at={REVEAL.badgeSlam} frames={3} peak={0.95} color="#dfffe8" />
      {captions ? <CaptionTrack lines={captionLines} /> : null}
    </AbsoluteFill>
  );
};
