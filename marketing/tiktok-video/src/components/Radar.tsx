/**
 * The Interference Radar beat. Rings open with staggered springs, a sweep
 * turns, then the finding lands: headline delta (the app's HeadlineStat
 * pattern — big number, micro-label, sentence), the per-day decay bars from
 * `decayByDay`, and the typed sentence — all from data.ts.
 */
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, microLabel, indexDisplay } from "../theme";
import { RADAR } from "../data";
import { SAFE_RECT } from "../timing";
import { SPRING_SETTLE, SPRING_SLAM, EASE_OUT } from "../fx";

const CX = 540;
const CY = 640;
const R = 300;

export const RadarDish: React.FC<{ openAt: number; sweepSpeed?: number }> = ({ openAt, sweepSpeed = 6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rings = [0.28, 0.52, 0.76, 1];
  const angle = ((frame - openAt) * sweepSpeed) % 360;
  const open = spring({ frame: frame - openAt, fps, config: SPRING_SETTLE, durationInFrames: 24 });
  return (
    <div style={{ position: "absolute", left: CX - R, top: CY - R, width: R * 2, height: R * 2, opacity: Math.min(1, open * 2) }}>
      <svg width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}>
        <defs>
          <radialGradient id="sweep" cx="0" cy="0" r="1">
            <stop offset="0%" stopColor="rgba(61,255,110,0.55)" />
            <stop offset="100%" stopColor="rgba(61,255,110,0)" />
          </radialGradient>
        </defs>
        {rings.map((r, i) => {
          const s = spring({ frame: frame - openAt - i * 3, fps, config: SPRING_SLAM, durationInFrames: 22 });
          return (
            <circle
              key={i}
              r={R * r * interpolate(s, [0, 1], [0.2, 1])}
              fill="none"
              stroke={i === rings.length - 1 ? "rgba(61,255,110,0.55)" : "rgba(61,255,110,0.22)"}
              strokeWidth={i === rings.length - 1 ? 3 : 2}
              opacity={Math.min(1, s * 2)}
            />
          );
        })}
        <line x1={-R} y1={0} x2={R} y2={0} stroke="rgba(61,255,110,0.14)" strokeWidth={2} />
        <line x1={0} y1={-R} x2={0} y2={R} stroke="rgba(61,255,110,0.14)" strokeWidth={2} />
        {/* sweep wedge */}
        <g transform={`rotate(${angle})`}>
          <path d={`M0 0 L${R} 0 A${R} ${R} 0 0 0 ${R * Math.cos(-0.9)} ${R * Math.sin(-0.9)} Z`} fill="url(#sweep)" opacity={0.9} />
          <line x1={0} y1={0} x2={R} y2={0} stroke={C.green} strokeWidth={3} opacity={0.9} />
        </g>
        {/* the two blips: a barbell (green) and a run (blue) */}
        <circle cx={-R * 0.42} cy={-R * 0.18} r={11} fill={C.green} opacity={interpolate(open, [0, 1], [0, 1])} />
        <circle cx={R * 0.38} cy={R * 0.3} r={11} fill={C.blue} opacity={interpolate(open, [0, 1], [0, 1])} />
        <circle cx={R * 0.38} cy={R * 0.3} r={11 + ((frame - openAt) % 30) * 1.6} fill="none" stroke={C.blue} strokeWidth={2} opacity={Math.max(0, 0.6 - ((frame - openAt) % 30) / 30)} />
      </svg>
    </div>
  );
};

/** Big delta + metric, the way HeadlineStat lays it out (number left, label under). */
export const HeadlineStat: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: SPRING_SLAM, durationInFrames: 18 });
  const s2 = spring({ frame: frame - at - 6, fps, config: SPRING_SLAM, durationInFrames: 18 });
  if (frame < at) return null;
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x, width: SAFE_RECT.w, top: 300, display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none" }}>
      <div style={{ ...microLabel(26), color: C.green, marginBottom: 6, opacity: Math.min(1, s * 2) }}>Interference Radar</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: SAFE_RECT.w }}>
        <div style={{ textAlign: "center", scale: String(interpolate(s, [0, 1], [2.2, 1])), opacity: Math.min(1, s * 2) }}>
          <div style={{ ...indexDisplay, fontSize: 190, color: C.white, textShadow: "0 0 60px rgba(250,250,250,0.25)", whiteSpace: "nowrap" }}>{RADAR.deltaLabel}</div>
          <div style={{ ...microLabel(24), marginTop: 4 }}>{RADAR.metricLabel}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 22, scale: String(interpolate(s2, [0, 1], [2.2, 1])), opacity: Math.min(1, s2 * 2) }}>
          <div style={{ ...indexDisplay, fontSize: 84, color: C.blue, whiteSpace: "nowrap" }}>{RADAR.hrLabel}</div>
          <div style={{ ...microLabel(22) }}>heart rate</div>
        </div>
      </div>
    </div>
  );
};

/** The finding, typed on. String slicing, never per-character opacity. */
export const TypedFinding: React.FC<{ from: number; to: number; y?: number }> = ({ from, to, y = 980 }) => {
  const frame = useCurrentFrame();
  const text = RADAR.sentence;
  const n = Math.round(interpolate(frame, [from, to], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_OUT }));
  if (frame < from) return null;
  const shown = text.slice(0, n);
  const done = n >= text.length;
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x + 30, width: SAFE_RECT.w - 60, top: y, pointerEvents: "none" }}>
      <div style={{ fontFamily: FONT.body, fontSize: 46, lineHeight: 1.25, fontWeight: 500, color: C.white, textShadow: "0 2px 0 rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.8)" }}>
        {shown}
        {!done ? <span style={{ color: C.green, opacity: frame % 6 < 3 ? 1 : 0 }}>▍</span> : null}
      </div>
      <div style={{ ...microLabel(20), marginTop: 18, opacity: done ? 1 : 0 }}>
        Computed from {RADAR.sampleCount} paired sessions in Sam's own log
      </div>
    </div>
  );
};

/** Per-day efficiency bars from decayByDay — the app's decay chart, simplified. */
export const DecayBars: React.FC<{ at: number; y?: number }> = ({ at, y = 800 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const label = (d: number) => (d === 0 ? "Same day" : d === 1 ? "Next day" : `Day ${d}`);
  const maxAbs = Math.max(...RADAR.decay.map((d) => Math.abs(d.efDeltaPct ?? 0)), 1);
  return (
    <div style={{ position: "absolute", left: SAFE_RECT.x + 40, width: SAFE_RECT.w - 80, top: y, display: "flex", flexDirection: "column", gap: 16, pointerEvents: "none" }}>
      {RADAR.decay.map((d, i) => {
        const s = spring({ frame: frame - at - i * 4, fps, config: SPRING_SETTLE, durationInFrames: 22 });
        const w = interpolate(s, [0, 1], [0, (Math.abs(d.efDeltaPct ?? 0) / maxAbs) * 520]);
        return (
          <div key={d.daysSinceStrength} style={{ display: "flex", alignItems: "center", gap: 20, opacity: Math.min(1, s * 2) }}>
            <div style={{ ...microLabel(22), width: 170, textAlign: "right" }}>{label(d.daysSinceStrength)}</div>
            <div style={{ height: 34, width: Math.max(6, w), borderRadius: 8, background: C.blue, boxShadow: "0 0 24px rgba(59,166,255,0.35)" }} />
            <div style={{ fontFamily: FONT.mono, fontSize: 30, fontWeight: 700, color: C.white }}>{d.efDeltaPct}%</div>
          </div>
        );
      })}
    </div>
  );
};

export const RadarBackground: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(70% 45% at 50% 34%, rgba(61,255,110,0.10), ${C.black} 70%)` }} />
);
