/**
 * USP · 9–14 s. The Interference Radar opens, the headline delta lands, the
 * decay bars grow, and the engine's own sentence types on.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { RadarDish, HeadlineStat, TypedFinding, DecayBars, RadarBackground } from "../components/Radar";
import { CaptionTrack } from "../components/Captions";
import { Aberration, Bloom, Flash, LightStreak, useImpact, SPRING_SETTLE } from "../fx";
import { USP } from "../timing";
import { RADAR } from "../data";

export const UspScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // after the headline lands the dish sinks to the background
  const sink = spring({ frame: frame - USP.headline, fps, config: SPRING_SETTLE, durationInFrames: 26 });
  const dishScale = interpolate(sink, [0, 1], [1, 0.62]);
  const dishY = interpolate(sink, [0, 1], [0, 640]);
  const dishOpacity = interpolate(sink, [0, 1], [1, 0.28]);
  const impact = useImpact(USP.headline, 5, 12);

  const q = RADAR.question.split(" ");

  return (
    <AbsoluteFill>
      <RadarBackground />
      <Bloom color="green" intensity={0.25} x={540} y={640 + dishY} size={1000} />
      <LightStreak y={300} color="green" width={1500} thickness={6} opacity={0.3} drift={300} progress={frame / 150} />
      <div style={{ position: "absolute", inset: 0, opacity: dishOpacity, translate: `0px ${dishY}px`, scale: String(dishScale), filter: `blur(${sink * 4}px)` }}>
        <RadarDish openAt={USP.radarOpen} />
      </div>
      <Aberration amount={impact}>
        <HeadlineStat at={USP.headline} />
      </Aberration>
      <DecayBars at={USP.headline + 10} y={790} />
      <TypedFinding from={USP.typeStart} to={USP.typeEnd} y={950} />
      <Flash at={USP.headline} frames={3} peak={0.5} color="#dfffe8" />
      <CaptionTrack lines={[{ at: 4, words: q, stagger: 4 }]} />
    </AbsoluteFill>
  );
};
