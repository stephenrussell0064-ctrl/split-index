/**
 * STATUS · 14–18 s. The bracket leaderboard scrolls fast, Sam's row climbs
 * into its real slot. "Ranked against your age, sex and bodyweight."
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import { LeaderboardHeader, LeaderboardList } from "../components/Leaderboard";
import { CaptionTrack } from "../components/Captions";
import { Bloom, Flash, LightStreak } from "../fx";
import { STATUS } from "../timing";
import { C } from "../theme";

export const StatusScene: React.FC = () => (
  <AbsoluteFill style={{ background: C.black }}>
    <Bloom color="green" intensity={0.16} x={540} y={1000} size={1200} />
    <LightStreak y={190} color="green" width={1500} thickness={5} opacity={0.25} />
    <LeaderboardHeader />
    <LeaderboardList scrollStart={STATUS.scrollStart} scrollEnd={STATUS.scrollEnd} climbStart={STATUS.climbStart} climbEnd={STATUS.climbEnd} />
    <Flash at={STATUS.climbEnd} frames={2} peak={0.45} color={C.green} />
    <CaptionTrack
      lines={[
        { at: 2, words: ["Ranked", "against", "your"] },
        { at: 34, words: ["age,", "sex", "and", "*bodyweight.*"] },
        { at: STATUS.climbEnd + 4, words: ["Your", "bracket.", "Your", "*rank.*"] },
      ]}
    />
  </AbsoluteFill>
);
