/**
 * TikTok safe-zone overlay. Toggled by the `safeZone` prop on the composition.
 * Hatched = covered by TikTok's own UI (caption, username, music, action rail,
 * top tabs). Green outline = where readable content must live.
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import { SAFE, SAFE_RECT, WIDTH, HEIGHT } from "../timing";
import { FONT } from "../theme";

const hatch =
  "repeating-linear-gradient(45deg, rgba(255,0,80,0.28) 0 6px, rgba(255,0,80,0.06) 6px 18px)";

export const SafeZone: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", zIndex: 1000 }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: WIDTH, height: SAFE.top, background: hatch }} />
    <div style={{ position: "absolute", left: 0, bottom: 0, width: WIDTH, height: SAFE.bottom, background: hatch }} />
    <div style={{ position: "absolute", right: 0, top: SAFE.top, width: SAFE.right, height: HEIGHT - SAFE.top - SAFE.bottom, background: hatch }} />
    <div style={{ position: "absolute", left: 0, top: SAFE.top, width: SAFE.left, height: HEIGHT - SAFE.top - SAFE.bottom, background: hatch }} />
    <div
      style={{
        position: "absolute",
        left: SAFE_RECT.x,
        top: SAFE_RECT.y,
        width: SAFE_RECT.w,
        height: SAFE_RECT.h,
        border: "3px dashed rgba(61,255,110,0.9)",
        boxSizing: "border-box",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: SAFE_RECT.x + 12,
        top: SAFE_RECT.y + 10,
        fontFamily: FONT.mono,
        fontSize: 22,
        color: "rgba(61,255,110,0.9)",
      }}
    >
      SAFE {SAFE_RECT.w}×{SAFE_RECT.h} · top {SAFE.top} · bottom {SAFE.bottom} · right {SAFE.right}
    </div>
  </AbsoluteFill>
);
