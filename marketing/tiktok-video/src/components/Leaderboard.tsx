/**
 * The bracket leaderboard. Rows and ranks come from data.ts — 24 athletes
 * scored by the app's engines and sorted. Sam's row is drawn separately so it
 * can climb: the list scrolls up from the bottom, his highlighted row rides
 * up from the floor and settles into the gap at his real rank, and the rank
 * number slams in only when he lands. Nobody else's rank is ever misdrawn.
 *
 * Row styling follows leaderboard-panel.tsx: rank (top three in the app's
 * warning-amber, here white to keep the palette), avatar, name + tier pill,
 * big tabular score. Sam's row uses the app's `bg-accent/10 ring-accent/30`.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Trail } from "@remotion/motion-blur";
import { C, FONT, microLabel, tierPill } from "../theme";
import { BOARD } from "../data";
import { SAFE_RECT } from "../timing";
import { RAMP_OUT, SPRING_SLAM } from "../fx";

export const ROW_H = 108;
const LIST_TOP = 400; // below the header
const LIST_LEFT = SAFE_RECT.x + 10;
const LIST_W = SAFE_RECT.w - 20;
const VISIBLE_ROWS = 8;

const Avatar: React.FC<{ handle: string; me?: boolean }> = ({ handle, me }) => (
  <div
    style={{
      width: 64,
      height: 64,
      borderRadius: 32,
      background: me ? "rgba(61,255,110,0.16)" : "rgba(255,255,255,0.06)",
      border: `2px solid ${me ? "rgba(61,255,110,0.6)" : "rgba(255,255,255,0.1)"}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: FONT.display,
      fontWeight: 700,
      fontSize: 24,
      color: me ? C.green : C.white,
      flexShrink: 0,
    }}
  >
    {handle[0].toUpperCase()}
  </div>
);

export const Row: React.FC<{
  rank: number | null;
  handle: string;
  score: string;
  tier: string;
  me?: boolean;
  rankAt?: number;
}> = ({ rank, handle, score, tier, me, rankAt = -100 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rs = spring({ frame: frame - rankAt, fps, config: SPRING_SLAM, durationInFrames: 16 });
  return (
    <div
      style={{
        height: ROW_H - 12,
        borderRadius: 26,
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "0 22px",
        background: me ? "#0b1c11" : "rgba(255,255,255,0.025)",
        boxShadow: me ? "0 0 0 2px rgba(61,255,110,0.45), 0 20px 60px rgba(61,255,110,0.18)" : "none",
        boxSizing: "border-box",
        fontFamily: FONT.body,
      }}
    >
      <div style={{ width: 64, textAlign: "center", fontFamily: FONT.display, fontWeight: 900, fontSize: 32, color: me ? C.green : C.muted, fontVariantNumeric: "tabular-nums", scale: rank !== null && me ? String(interpolate(rs, [0, 1], [2.4, 1])) : "1" }}>
        {rank === null ? "" : `${me ? "#" : ""}${rank}`}
      </div>
      <Avatar handle={handle} me={me} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 30, fontWeight: 600, color: C.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{handle}</span>
          <span style={{ ...tierPill(13), padding: "5px 10px", color: me ? C.green : "rgba(250,250,250,0.7)" }}>{tier}</span>
        </div>
        <span style={{ fontSize: 19, color: C.muted }}>@{handle}</span>
      </div>
      <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 40, color: me ? C.green : C.white, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>{score}</div>
    </div>
  );
};

export const LeaderboardHeader: React.FC = () => (
  <div style={{ position: "absolute", left: SAFE_RECT.x + 10, right: SAFE_RECT.x + 10, top: 210 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, ...microLabel(24) }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a2 2 0 0 0 0 4h3M17 6h3a2 2 0 0 1 0 4h-3" />
      </svg>
      Leaderboard
    </div>
    <div style={{ marginTop: 14, ...microLabel(20), color: "rgba(250,250,250,0.55)" }}>Your bracket</div>
    <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 46, color: C.white, marginTop: 6, letterSpacing: "-0.02em" }}>{BOARD.bracketLabel}</div>
  </div>
);

/**
 * @param scrollStart..scrollEnd  the list races up from the bottom to Sam's neighbourhood
 * @param climbStart..climbEnd    Sam's row rides from the floor into its slot
 */
export const LeaderboardList: React.FC<{ scrollStart: number; scrollEnd: number; climbStart: number; climbEnd: number }> = ({
  scrollStart,
  scrollEnd,
  climbStart,
  climbEnd,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rows = BOARD.rows;
  const meIdx = rows.findIndex((r) => r.isDemo);
  const total = rows.length;

  // Final scroll puts Sam's slot at row position 4 of 9 (roughly centre).
  const targetOffset = Math.max(0, meIdx - 4) * ROW_H;
  const startOffset = Math.max(0, total - VISIBLE_ROWS) * ROW_H;
  const offset = interpolate(frame, [scrollStart, scrollEnd], [startOffset, targetOffset], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: RAMP_OUT });

  const climbCfg = { damping: 30, stiffness: 46, mass: 1.3 };
  const climb = spring({ frame: frame - climbStart, fps, config: climbCfg, durationInFrames: climbEnd - climbStart });
  const slotY = LIST_TOP + meIdx * ROW_H - offset; // where Sam's slot is in frame right now
  const floorY = LIST_TOP + VISIBLE_ROWS * ROW_H + 40; // just off the bottom of the list window
  const meY = interpolate(climb, [0, 1], [floorY, slotY]);
  // the frame he lands — found once from the same spring, so the rank slam is deterministic
  let landFrame = climbEnd;
  for (let f = climbStart; f <= climbEnd + 30; f++) {
    if (spring({ frame: f - climbStart, fps, config: climbCfg, durationInFrames: climbEnd - climbStart }) > 0.985) {
      landFrame = f;
      break;
    }
  }
  const landed = frame >= landFrame;
  const scrolling = frame >= scrollStart && frame < scrollEnd + 4;

  const list = (
    <div style={{ position: "absolute", left: LIST_LEFT, width: LIST_W, top: LIST_TOP - offset, display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) =>
        r.isDemo ? (
          <div key={r.handle} style={{ height: ROW_H - 12, borderRadius: 26, border: "2px dashed rgba(61,255,110,0.25)", boxSizing: "border-box", opacity: landed ? 0 : 1 }} />
        ) : (
          <Row key={r.handle} rank={r.rank} handle={r.handle} score={r.splitDisplay} tier={r.tier} />
        ),
      )}
    </div>
  );

  const me = rows[meIdx];

  return (
    <AbsoluteFill>
      {/* list window — clipped to the safe rect so nothing readable leaves it */}
      <div style={{ position: "absolute", left: 0, right: 0, top: LIST_TOP - 6, height: VISIBLE_ROWS * ROW_H + 12, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, top: -(LIST_TOP - 6) }}>
          {scrolling ? (
            <Trail layers={4} lagInFrames={0.5} trailOpacity={0.5}>
              {list}
            </Trail>
          ) : (
            list
          )}
          {/* Sam's row rides on top */}
          <div style={{ position: "absolute", left: LIST_LEFT, width: LIST_W, top: meY, scale: String(landed ? 1 : 1.03), zIndex: 2 }}>
            <Row rank={landed ? me.rank : null} handle={me.handle} score={me.splitDisplay} tier={me.tier} me rankAt={landFrame} />
          </div>
        </div>
        {/* fades top and bottom of the window */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 90, background: `linear-gradient(${C.black}, transparent)`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, background: `linear-gradient(transparent, ${C.black})`, pointerEvents: "none" }} />
      </div>
    </AbsoluteFill>
  );
};
