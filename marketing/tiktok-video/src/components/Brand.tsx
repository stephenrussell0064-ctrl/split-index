/**
 * Brand furniture: the wordmark (as brand-mark.tsx renders it — SPLIT green,
 * slash white/28, INDEX blue, Unbounded 900) and Apple's official badge.
 *
 * The badge is Apple's own SVG, downloaded unaltered from Apple's badge
 * service (tools.applemediaservices.com, "Download on the App Store", black,
 * en-GB). It is rendered with <Img>, never redrawn, never recoloured, and
 * with the clear space Apple asks for (a quarter of its height on all sides).
 */
import React from "react";
import { Img, staticFile } from "remotion";
import { C, FONT } from "../theme";

export const Wordmark: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 72, style }) => (
  <div style={{ display: "inline-flex", alignItems: "baseline", gap: size * 0.08, fontFamily: FONT.display, fontWeight: 900, fontSize: size, letterSpacing: "-0.02em", lineHeight: 1, ...style }}>
    <span style={{ color: C.green }}>SPLIT</span>
    <span style={{ color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>/</span>
    <span style={{ color: C.blue }}>INDEX</span>
  </div>
);

/** Apple's badge is 119.66 × 40 units. `height` sets the rendered height; width follows. */
export const AppStoreBadge: React.FC<{ height?: number; style?: React.CSSProperties }> = ({ height = 132, style }) => {
  const width = (height * 119.66407) / 40;
  const pad = height / 4;
  return (
    <div style={{ display: "inline-block", padding: pad, ...style }}>
      <Img src={staticFile("app-store-badge-en-gb.svg")} style={{ width, height, display: "block" }} />
    </div>
  );
};
