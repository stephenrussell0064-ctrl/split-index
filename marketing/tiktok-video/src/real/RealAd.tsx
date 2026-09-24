/**
 * The real-footage film. Same beat grid, same hooks mechanism, same grade as
 * Ad.tsx — but every frame inside the phone is the actual app: screen
 * recordings (Clip) and unedited screenshots the camera moves across (Screen).
 * No UI is redrawn. Captions only quote what is on the screen beneath them.
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SCENES, dur, beat, WIDTH, HEIGHT, FLASH_FRAMES, SAFE_RECT, SHORT } from "../timing";
import { WhipIn, Grade, type AdProps } from "../Ad";
import { HookScene } from "../scenes/Hook";
import { CtaScene } from "../scenes/Cta";
import { Phone } from "../components/Phone";
import { CaptionTrack } from "../components/Captions";
import { AberrationDefs, Aberration, Bloom, Defocus, Flash, LightStreak, Shake, useImpact, RAMP_IN, SPRING_CAMERA } from "../fx";
import { SfxTrack, SfxTrackShort } from "../Sfx";
import { C, microLabel } from "../theme";
import { REAL, CLIPS, STILLS } from "./data";
import { REAL_HOOKS } from "./hooks";
import { Clip, Screen, BleedClip } from "./Shots";

const SAFE_DX = SAFE_RECT.x + SAFE_RECT.w / 2 - 540;

/** Small provenance line — whose screen this is. */
const Provenance: React.FC<{ text: string; y?: number }> = ({ text, y = 205 }) => (
  <div style={{ position: "absolute", left: SAFE_RECT.x + 30, top: y, ...microLabel(22), color: "rgba(250,250,250,0.5)", pointerEvents: "none" }}>{text}</div>
);

// ─────────────────────────────────────────────────────────────────────────────
// TENSION · real footage, Lab vs Engine, colliding
// ─────────────────────────────────────────────────────────────────────────────

const TensionReal: React.FC<{ subvert?: string[] }> = ({ subvert }) => {
  const frame = useCurrentFrame();
  const shot = Math.min(4, Math.floor(frame / beat(1)));
  const hit = beat(4);
  const travel = interpolate(frame, [beat(3), hit], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: RAMP_IN });
  const impact = useImpact(hit, 6, 16);
  const captions = subvert
    ? [
        { at: 0, words: subvert, stagger: 5 },
        { at: beat(2), words: ["Same", "body."] },
        { at: beat(4), words: ["One", "*score.*"] },
      ]
    : [
        { at: 0, words: ["Your", "*lifting.*"] },
        { at: beat(1), words: ["Your", "_running._"] },
        { at: beat(2), words: ["Same", "body."] },
        { at: beat(4), words: ["One", "*score.*"] },
      ];
  const tint = (rgb: string) => <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(${rgb},0.18), transparent 40%, rgba(0,0,0,0.35))`, mixBlendMode: "screen", pointerEvents: "none" }} />;

  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Shake at={hit} frames={10} amplitude={30}>
        <Aberration amount={impact}>
          {shot === 0 ? (
            <>
              <div style={{ position: "absolute", inset: 0, clipPath: "inset(0 50% 0 0)" }}>
                <Sequence layout="none">
                  <BleedClip src={CLIPS.setScoring} from={0.4} zoom={1.5} originY="22%" />
                </Sequence>
                {tint("61,255,110")}
              </div>
              <div style={{ position: "absolute", inset: 0, clipPath: "inset(0 0 0 50%)" }}>
                <Sequence layout="none">
                  <BleedClip src={CLIPS.engine} from={6.0} zoom={1.5} originY="30%" />
                </Sequence>
                {tint("59,166,255")}
              </div>
              <div style={{ position: "absolute", left: WIDTH / 2 - 3, top: 0, bottom: 0, width: 6, background: C.white }} />
            </>
          ) : null}
          {shot === 1 ? (
            <Sequence from={beat(1)} layout="none">
              <BleedClip src={CLIPS.engine} from={7.5} zoom={1.45} originY="35%" />
              {tint("59,166,255")}
            </Sequence>
          ) : null}
          {shot === 2 ? (
            <Sequence from={beat(2)} layout="none">
              <BleedClip src={CLIPS.lab} from={4.5} zoom={1.45} originY="30%" />
              {tint("61,255,110")}
            </Sequence>
          ) : null}
          {shot >= 3 ? (
            <>
              <AbsoluteFill style={{ opacity: 1 - travel }}>
                <Sequence from={beat(3)} layout="none">
                  <BleedClip src={CLIPS.lab} from={5.5} zoom={1.45} originY="30%" />
                </Sequence>
              </AbsoluteFill>
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 ${interpolate(travel, [0, 1], [100, 50])}% 0)` }}>
                <AbsoluteFill style={{ translate: `0px ${interpolate(travel, [0, 1], [-HEIGHT * 0.5, 0])}px` }}>
                  <Sequence from={beat(3)} layout="none">
                    <BleedClip src={CLIPS.setScoring} from={9.6} zoom={1.5} originY="40%" />
                  </Sequence>
                  {tint("61,255,110")}
                </AbsoluteFill>
              </div>
              <div style={{ position: "absolute", inset: 0, clipPath: `inset(${interpolate(travel, [0, 1], [100, 50])}% 0 0 0)` }}>
                <AbsoluteFill style={{ translate: `0px ${interpolate(travel, [0, 1], [HEIGHT * 0.5, 0])}px` }}>
                  <Sequence from={beat(3)} layout="none">
                    <BleedClip src={CLIPS.engine} from={1.5} zoom={1.5} originY="30%" />
                  </Sequence>
                  {tint("59,166,255")}
                </AbsoluteFill>
              </div>
              <LightStreak y={HEIGHT / 2} color="white" width={1400} thickness={interpolate(travel, [0.7, 1], [0, 26], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} opacity={travel} />
            </>
          ) : null}
        </Aberration>
      </Shake>
      {[1, 2, 3].map((b) => (
        <Flash key={b} at={beat(b)} frames={2} peak={0.85} color={b % 2 ? C.white : "#dfffe8"} />
      ))}
      <Flash at={hit} frames={4} peak={1} />
      <CaptionTrack lines={captions} />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// REVEAL · log a set (recording) → the app counts a session score up (recording)
//          → the dashboard: 75.9 Advanced (screenshot) → race times + 1RM
// ─────────────────────────────────────────────────────────────────────────────

export const REVEAL_REAL = {
  logClip: 0,
  countClip: 40, // whip to the live count-up
  countLands: 76, // the app's own counter settles (clip 0.3 s + ~1.2 s)
  dashboard: 100, // whip to the real dashboard, badge beat
  panDown: 122, // race times + 1RM
} as const;

export const RevealReal: React.FC<{ coverMode?: boolean; captions?: boolean }> = ({ coverMode, captions = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const R = REVEAL_REAL;

  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 40 });
  const push = spring({ frame: frame - R.dashboard, fps, config: { damping: 60, stiffness: 30, mass: 1.6 }, durationInFrames: 50 });
  let rotateY = interpolate(enter, [0, 1], [42, 14]) * (1 - push);
  let rotateX = interpolate(enter, [0, 1], [14, 6]) * (1 - push);
  let rotateZ = interpolate(enter, [0, 1], [-8, -3]) * (1 - push);
  let scale = interpolate(enter, [0, 1], [0.9, 1.12]) * (1 - push) + 1.18 * push;
  let y = interpolate(enter, [0, 1], [900, 20]) * (1 - push) + 70 * push;
  if (coverMode) {
    rotateY = 12; rotateX = 5; rotateZ = -2; scale = 1.1; y = 360;
  }

  const impactCount = useImpact(R.countLands, 5, 10);
  const impactDash = useImpact(R.dashboard, 6, 18);
  const glow = interpolate(frame, [R.countClip, R.countLands, R.dashboard, R.dashboard + 8], [0.1, 0.6, 0.6, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const screen = coverMode || frame >= R.dashboard ? (
    <Sequence from={coverMode ? 0 : R.dashboard} layout="none">
      <Screen src={REAL.dashboard.file} focusFrom={[590, 700]} focusTo={coverMode ? [590, 700] : [590, 1500]} zoomFrom={1.08} zoomTo={coverMode ? 1.08 : 1.0} frames={40} delay={R.panDown - R.dashboard} />
    </Sequence>
  ) : frame >= R.countClip ? (
    <Sequence from={R.countClip} layout="none">
      <Clip src={CLIPS.sessionDone} from={0.3} zoom={1.08} />
    </Sequence>
  ) : (
    <Sequence from={R.logClip} layout="none">
      <Clip src={CLIPS.setScoring} from={0.0} />
    </Sequence>
  );

  const captionLines = [
    { at: 2, words: ["Log", "a", "set."] },
    { at: 22, words: ["Scored", "as", "you", "type."] },
    { at: R.countClip + 4, words: ["Every", "session", "*scored.*"] },
    { at: R.dashboard + 2, words: ["Your", "Split", "Index."] },
    { at: R.dashboard + 14, words: [`*${REAL.dashboard.tier}.*`] },
    { at: R.panDown + 6, words: ["5k", `_${REAL.dashboard.predicted.fiveK}._`, "Bench", `*${REAL.dashboard.oneRM.bench}.*`] },
  ];

  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Defocus blur={30} opacity={0.9}>
        <Bloom color="green" intensity={0.2 + glow * 0.5} x={540 + SAFE_DX} y={760} size={1100} />
        <Bloom color="blue" intensity={0.1 + glow * 0.2} x={540 + SAFE_DX} y={1500} size={900} />
      </Defocus>
      <LightStreak y={560} color="green" width={1600} thickness={8} opacity={0.3 + glow * 0.5} drift={200} progress={glow} />
      <LightStreak y={1240} color="blue" width={1300} thickness={5} opacity={0.2 + glow * 0.3} drift={-160} progress={glow} />
      <Shake at={R.dashboard} frames={10} amplitude={22}>
        <Aberration amount={Math.max(impactCount, impactDash)}>
          <Phone rotateX={rotateX} rotateY={rotateY} rotateZ={rotateZ} scale={scale} x={SAFE_DX} y={y}>
            {screen}
          </Phone>
        </Aberration>
      </Shake>
      <Flash at={R.countClip} frames={2} peak={0.5} />
      <Flash at={R.countLands} frames={2} peak={0.45} color="#dfffe8" />
      <Flash at={R.dashboard} frames={3} peak={0.9} color="#dfffe8" />
      {!coverMode ? <Provenance text={frame >= R.dashboard ? `@${REAL.handle} · real account · 22 Sep 2026` : "Real screen recording"} /> : null}
      {captions ? <CaptionTrack lines={captionLines} /> : null}
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// USP · the real Interference Radar page
// ─────────────────────────────────────────────────────────────────────────────

const UspReal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 36 });
  const rotateY = interpolate(enter, [0, 1], [-30, -8]);
  const y = interpolate(enter, [0, 1], [500, 60]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 34%, rgba(61,255,110,0.10), ${C.black} 70%)` }}>
      <Bloom color="green" intensity={0.22} x={540} y={800} size={1000} />
      <LightStreak y={300} color="green" width={1500} thickness={6} opacity={0.3} drift={300} progress={frame / 150} />
      <Phone rotateY={rotateY} rotateX={4} rotateZ={2} scale={1.22} x={SAFE_DX} y={y}>
        <Screen src={REAL.radar.file} focusFrom={[590, 800]} focusTo={[590, 1250]} zoomFrom={1.2} zoomTo={1.1} frames={70} delay={beat(3)} />
      </Phone>
      <Provenance text={`@${REAL.handle} · Interference Radar`} />
      <CaptionTrack
        lines={[
          { at: 4, words: ["Does", "_cardio_", "weaken", "your", "*lifting?*"] },
          { at: beat(3), words: ["The", "app", "checks."] },
          { at: beat(5), words: ["Mine:", "no.", `*${REAL.radar.delta}.*`] },
          { at: beat(7) + 8, words: [`${REAL.radar.sessions}`, "gym", "sessions."] },
          { at: beat(9), words: ["Yours", "might", "differ."] },
        ]}
      />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STATUS · the real bracket leaderboard, then the real race records
// ─────────────────────────────────────────────────────────────────────────────

const StatusReal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: SPRING_CAMERA, durationInFrames: 36 });
  const swap = beat(4);
  const rotateY = interpolate(enter, [0, 1], [26, 8]);
  const y = interpolate(enter, [0, 1], [500, 60]);
  const impact = useImpact(swap, 5, 12);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Bloom color="green" intensity={0.16} x={540} y={1000} size={1200} />
      <LightStreak y={190} color="green" width={1500} thickness={5} opacity={0.25} />
      <Aberration amount={impact}>
        <Phone rotateY={rotateY} rotateX={4} rotateZ={-2} scale={1.22} x={SAFE_DX} y={y}>
          {frame < swap ? (
            <Screen src={STILLS.leaderboard} size={[720, 1560]} focusFrom={[360, 640]} focusTo={[360, 700]} zoomFrom={1.0} zoomTo={1.22} frames={swap} />
          ) : (
            <Sequence from={swap} layout="none">
              <Screen src={REAL.records.file} focusFrom={[590, 620]} focusTo={[590, 900]} zoomFrom={1.15} zoomTo={1.05} frames={50} />
            </Sequence>
          )}
        </Phone>
      </Aberration>
      <Flash at={swap} frames={3} peak={0.6} />
      <Provenance text={frame < swap ? "Real leaderboard · test account" : `@${REAL.handle} · race records`} />
      <CaptionTrack
        lines={[
          { at: 2, words: ["Ranked", "against", "your"] },
          { at: 30, words: ["age,", "sex", "and", "*bodyweight.*"] },
          { at: swap + 4, words: ["Race", "records."] },
          { at: swap + 24, words: ["5k", `_${REAL.records.fiveK}._`, "Deadlift", `*${REAL.dashboard.oneRM.deadlift}.*`] },
        ]}
      />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// The films
// ─────────────────────────────────────────────────────────────────────────────

export const RealAd: React.FC<AdProps> = ({ hook, safeZone, sfx }) => {
  const h = REAL_HOOKS[hook];
  const cuts = [SCENES.tension.from, SCENES.reveal.from, SCENES.usp.from, SCENES.status.from, SCENES.cta.from];
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      <Sequence from={SCENES.hook.from} durationInFrames={dur(SCENES.hook)}>
        <HookScene hook={h} />
      </Sequence>
      <Sequence from={SCENES.tension.from} durationInFrames={dur(SCENES.tension)}>
        <WhipIn from="right">
          <TensionReal subvert={h.subvert} />
        </WhipIn>
      </Sequence>
      <Sequence from={SCENES.reveal.from} durationInFrames={dur(SCENES.reveal)}>
        <WhipIn from="down">
          <RevealReal />
        </WhipIn>
      </Sequence>
      <Sequence from={SCENES.usp.from} durationInFrames={dur(SCENES.usp)}>
        <WhipIn from="left">
          <UspReal />
        </WhipIn>
      </Sequence>
      <Sequence from={SCENES.status.from} durationInFrames={dur(SCENES.status)}>
        <WhipIn from="up">
          <StatusReal />
        </WhipIn>
      </Sequence>
      <Sequence from={SCENES.cta.from} durationInFrames={dur(SCENES.cta) + dur(SCENES.loop)}>
        <WhipIn from="right">
          <CtaScene exitAt={dur(SCENES.cta) - 2} exitFrames={22} />
        </WhipIn>
      </Sequence>
      {cuts.map((c) => (
        <Flash key={c} at={c} frames={2} peak={0.9} />
      ))}
      <Grade safeZone={safeZone} />
      {sfx ? <SfxTrack hook={h} /> : null}
    </AbsoluteFill>
  );
};

export const RealAdShort: React.FC<AdProps> = ({ hook, safeZone, sfx }) => {
  const h = REAL_HOOKS[hook];
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AberrationDefs />
      <Sequence from={SHORT.hook.from} durationInFrames={dur(SHORT.hook)}>
        <HookScene hook={h} />
      </Sequence>
      <Sequence from={SHORT.reveal.from} durationInFrames={dur(SHORT.reveal)}>
        <WhipIn from="down">
          <RevealReal />
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
