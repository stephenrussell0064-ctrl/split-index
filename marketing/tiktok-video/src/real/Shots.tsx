/**
 * Real app footage inside the phone.
 *
 *   <Clip>   a screen recording, trimmed to a start second, untouched.
 *   <Screen> a screenshot (1179×2556) that the camera pans and pushes across.
 *
 * Both cover the iOS status bar with a drawn island bar: every recording
 * carries the red screen-recording pill, and a 12:46 clock in one shot and
 * 12:33 in the next reads as a cut between days. Nothing else on the screen
 * is altered.
 */
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { SCREEN_W, SCREEN_H } from "../components/Phone";
import { EASE_OUT } from "../fx";

const NotchBar: React.FC = () => (
  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 74, background: "#000", zIndex: 5 }} />
);

export const Clip: React.FC<{ src: string; from: number; zoom?: number }> = ({ src, from, zoom = 1 }) => {
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: "absolute", inset: 0, width: SCREEN_W, height: SCREEN_H, overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", inset: 0, scale: String(zoom), transformOrigin: "50% 30%" }}>
        <Video src={staticFile(src)} trimBefore={Math.round(from * fps)} objectFit="cover" style={{ width: "100%", height: "100%" }} />
      </div>
      <NotchBar />
    </div>
  );
};

/**
 * A screenshot with a camera move. `focusFrom` → `focusTo` are points in the
 * screenshot's own pixel space (1179×2556) that sit at the phone's centre at
 * the start and end; `zoomFrom` → `zoomTo` the magnification. `frames` is
 * how long the move takes from the shot's first frame.
 */
export const Screen: React.FC<{
  src: string;
  focusFrom?: [number, number];
  focusTo?: [number, number];
  zoomFrom?: number;
  zoomTo?: number;
  frames?: number;
  delay?: number;
  /** Natural pixel size of the file: screenshots are 1179×2556, frames pulled from recordings 720×1560. */
  size?: [number, number];
}> = ({ src, focusFrom, focusTo, zoomFrom = 1, zoomTo = zoomFrom, frames = 60, delay = 0, size = [1179, 2556] }) => {
  const [natW, natH] = size;
  const f0 = focusFrom ?? [natW / 2, natH / 2];
  const f1 = focusTo ?? f0;
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT });
  const zoom = interpolate(p, [0, 1], [zoomFrom, zoomTo]);
  const fx = interpolate(p, [0, 1], [f0[0], f1[0]]);
  const fy = interpolate(p, [0, 1], [f0[1], f1[1]]);
  const k = SCREEN_W / natW; // file px → screen px
  const imgW = natW * k * zoom;
  const imgH = natH * k * zoom;
  // put the focus point at the centre of the phone screen, clamped so the image never shows its edge
  let left = SCREEN_W / 2 - fx * k * zoom;
  let top = SCREEN_H / 2 - fy * k * zoom;
  left = Math.min(0, Math.max(SCREEN_W - imgW, left));
  top = Math.min(0, Math.max(SCREEN_H - imgH, top));
  return (
    <div style={{ position: "absolute", inset: 0, width: SCREEN_W, height: SCREEN_H, overflow: "hidden", background: "#000" }}>
      <Img src={staticFile(src)} style={{ position: "absolute", left, top, width: imgW, height: imgH }} />
      <NotchBar />
    </div>
  );
};

/** Full-bleed version for the tension split-screens: the recording fills the frame, no phone. */
export const BleedClip: React.FC<{ src: string; from: number; zoom?: number; originY?: string }> = ({ src, from, zoom = 1.9, originY = "22%" }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", inset: 0, scale: String(zoom), transformOrigin: `50% ${originY}` }}>
        <Video src={staticFile(src)} trimBefore={Math.round(from * fps)} objectFit="cover" style={{ width: "100%", height: "100%" }} />
      </div>
    </AbsoluteFill>
  );
};
