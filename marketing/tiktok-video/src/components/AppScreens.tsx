/**
 * Recreations of two app screens, built from the same tokens and copy the
 * app uses (see theme.ts), sized to the phone's SCREEN_W × SCREEN_H.
 *
 * Why recreations and not the app's React components: the components in
 * src/components/dashboard/* depend on Next.js (`next/link`), Tailwind class
 * names compiled by the app's PostCSS pipeline, framer-motion, and app-shell
 * context. They do not render outside the app. What IS the app's is every
 * number and every string — see data.ts.
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, microLabel, tierPill } from "../theme";
import { SCREEN_W, SCREEN_H, StatusBar, TabBar } from "./Phone";
import { Odometer } from "./Odometer";
import { DEMO, SCORE } from "../data";
import { SPRING_POP, SPRING_SETTLE } from "../fx";

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; tone?: "lab" | "neutral" }> = ({ children, style, tone = "neutral" }) => (
  <div
    style={{
      background: tone === "lab" ? "rgba(10,14,10,0.92)" : C.card,
      border: `1px solid ${tone === "lab" ? "rgba(61,255,110,0.18)" : C.cardBorder}`,
      borderRadius: 34,
      padding: "28px 30px",
      ...style,
    }}
  >
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// The Lab — logging a set. `setAt` is the frame the set row fills in;
// `scoreAt` the frame the per-set score pill pops; `saveAt` the Save press.
// ─────────────────────────────────────────────────────────────────────────────

export const LogSetScreen: React.FC<{ setAt: number; scoreAt: number; saveAt: number }> = ({ setAt, scoreAt, saveAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const set = DEMO.loggedSet;

  const rowIn = spring({ frame: frame - setAt, fps, config: SPRING_SETTLE, durationInFrames: 14 });
  const pill = spring({ frame: frame - scoreAt, fps, config: SPRING_POP, durationInFrames: 16 });
  const press = frame >= saveAt ? interpolate(frame - saveAt, [0, 3, 8], [1, 0.94, 1], { extrapolateRight: "clamp" }) : 1;

  const weightDigits = String(set.weightKg);
  const typed = frame < setAt ? "" : weightDigits.slice(0, Math.min(weightDigits.length, Math.floor((frame - setAt) / 3) + 1));

  return (
    <div style={{ position: "absolute", inset: 0, background: C.labBg, width: SCREEN_W, height: SCREEN_H, fontFamily: FONT.body }}>
      <StatusBar />
      {/* top bar */}
      <div style={{ position: "absolute", top: 86, left: 30, right: 30 }}>
        <div style={{ ...microLabel(16), color: C.green }}>Strength · The Lab</div>
        <div style={{ fontSize: 40, fontWeight: 700, color: C.white, marginTop: 8, letterSpacing: "-0.02em" }}>Push</div>
        <div style={{ fontSize: 18, color: C.muted, marginTop: 4 }}>Mon 14 Sep · 62 min</div>
      </div>

      <div style={{ position: "absolute", top: 232, left: 22, right: 22, display: "flex", flexDirection: "column", gap: 18 }}>
        <Card tone="lab">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: C.white }}>{set.exercise}</div>
            <div style={{ ...microLabel(14) }}>Chest</div>
          </div>

          {/* header row */}
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 190px", marginTop: 22, ...microLabel(13) }}>
            <span>Set</span>
            <span>kg</span>
            <span>Reps</span>
            <span style={{ textAlign: "right" }}>Score</span>
          </div>

          {/* the set row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr 1fr 190px",
              alignItems: "center",
              marginTop: 14,
              padding: "16px 0",
              borderTop: `1px solid ${C.cardBorder}`,
              borderBottom: `1px solid ${C.cardBorder}`,
              opacity: interpolate(rowIn, [0, 1], [0.35, 1]),
              translate: `0px ${interpolate(rowIn, [0, 1], [10, 0])}px`,
            }}
          >
            <span style={{ fontSize: 24, color: C.muted, fontWeight: 600 }}>1</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 46, fontWeight: 700, color: C.white, minHeight: 54 }}>
              {typed}
              {typed.length < weightDigits.length && frame >= setAt ? <span style={{ color: C.green, opacity: frame % 8 < 4 ? 1 : 0 }}>|</span> : null}
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: 46, fontWeight: 700, color: typed.length === weightDigits.length ? C.white : "rgba(250,250,250,0.25)" }}>
              {set.reps}
            </span>
            <span style={{ display: "flex", justifyContent: "flex-end" }}>
              {frame >= scoreAt ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(61,255,110,0.12)",
                    border: "1px solid rgba(61,255,110,0.35)",
                    borderRadius: 999,
                    padding: "10px 16px",
                    scale: String(interpolate(pill, [0, 1], [0.5, 1])),
                    opacity: Math.min(1, pill * 2),
                  }}
                >
                  <span style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 34, color: C.green, letterSpacing: "-0.03em" }}>{set.liftScoreDisplay}</span>
                  <span style={{ ...microLabel(15), color: C.green }}>{set.liftTier}</span>
                </span>
              ) : (
                <span style={{ ...microLabel(13), color: "rgba(250,250,250,0.25)" }}>—</span>
              )}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, fontSize: 17, color: C.muted }}>
            <span>Predicted 1RM</span>
            <span style={{ fontFamily: FONT.mono, color: frame >= scoreAt ? C.green : C.muted }}>
              {frame >= scoreAt ? `${set.estimatedOneRMKg} kg` : "—"}
            </span>
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.white }}>Overhead Press</div>
              <div style={{ fontSize: 17, color: C.muted, marginTop: 4 }}>3 sets logged</div>
            </div>
            <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 26, color: C.green }}>
              {DEMO.lifts.find((l) => l.liftKey === "ohp")?.scoreDisplay}
            </div>
          </div>
        </Card>

        {/* Save button */}
        <div
          style={{
            marginTop: 6,
            height: 84,
            borderRadius: 26,
            background: C.green,
            color: "#04120a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 700,
            scale: String(press),
            boxShadow: frame >= saveAt && frame < saveAt + 10 ? "0 0 60px rgba(61,255,110,0.7)" : "0 10px 30px rgba(61,255,110,0.25)",
          }}
        >
          Save session
        </div>
      </div>
      <TabBar active="lab" />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — the IndexHero. Copy is the app's: "SPLIT INDEX", tier pill,
// "Strength + endurance, out of 100", ENGINE / LAB sub-scores.
// ─────────────────────────────────────────────────────────────────────────────

export const DashboardScreen: React.FC<{
  /** Current odometer value, 0–100 scale. */
  value: number;
  /** Frame the tier pill slams. */
  badgeAt: number;
  /** Frame the Engine/Lab sub-scores fade up. */
  subAt: number;
  /** 0–1: how bright the score glow is. */
  glow: number;
}> = ({ value, badgeAt, subAt, glow }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badge = spring({ frame: frame - badgeAt, fps, config: { damping: 11, stiffness: 300, mass: 0.8 }, durationInFrames: 18 });
  const sub = spring({ frame: frame - subAt, fps, config: SPRING_SETTLE, durationInFrames: 20 });
  const glowCss = glow < 0.02 ? "none" : `drop-shadow(0 0 ${Math.round(glow * 28)}px rgba(250,250,250,${(glow * 0.6).toFixed(2)})) drop-shadow(0 0 ${Math.round(glow * 70)}px rgba(61,255,110,${(glow * 0.45).toFixed(2)}))`;

  return (
    <div style={{ position: "absolute", inset: 0, background: C.black, width: SCREEN_W, height: SCREEN_H, fontFamily: FONT.body }}>
      <StatusBar />
      <div style={{ position: "absolute", top: 96, left: 24, right: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.white }}>
          Hi, {DEMO.athlete.handle}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: "rgba(255,255,255,0.06)" }} />
      </div>

      <div style={{ position: "absolute", top: 160, left: 22, right: 22 }}>
        <Card style={{ padding: "32px 30px 30px", background: "linear-gradient(180deg, rgba(20,24,20,0.9), rgba(14,14,14,0.85))" }}>
          <div style={microLabel(15)}>Split Index</div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
            <Odometer value={value} size={132} color={C.white} glow={glowCss} />
            {frame >= badgeAt ? (
              <span
                style={{
                  ...tierPill(24),
                  marginBottom: 26,
                  scale: String(interpolate(badge, [0, 1], [3.2, 1])),
                  opacity: Math.min(1, badge * 3),
                  background: "rgba(255,255,255,0.1)",
                  color: C.white,
                  whiteSpace: "nowrap",
                }}
              >
                {SCORE.splitTier}
              </span>
            ) : null}
          </div>

          <div style={{ fontSize: 18, color: C.muted, marginTop: 10 }}>Strength + endurance, out of 100</div>
          <div style={{ fontSize: 18, color: C.muted, marginTop: 4, fontWeight: 500 }}>Updated just now</div>

          <div style={{ height: 1, background: C.cardBorder, margin: "26px 0 22px" }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, opacity: sub, translate: `0px ${interpolate(sub, [0, 1], [14, 0])}px` }}>
            <div>
              <div style={microLabel(14)}>Engine</div>
              <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 52, color: C.blue, letterSpacing: "-0.04em", marginTop: 8 }}>{SCORE.engine}</div>
              <div style={{ fontSize: 17, color: C.muted, marginTop: 4 }}>Endurance score</div>
            </div>
            <div>
              <div style={microLabel(14)}>Lab</div>
              <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 52, color: C.green, letterSpacing: "-0.04em", marginTop: 8 }}>{SCORE.lab}</div>
              <div style={{ fontSize: 17, color: C.muted, marginTop: 4 }}>Strength score</div>
            </div>
          </div>
        </Card>

        <Card style={{ marginTop: 18, opacity: sub }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={microLabel(14)}>Predicted 1RM</div>
            <div style={{ fontSize: 16, color: C.muted }}>from your logged sets</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16 }}>
            {(["squat", "bench", "deadlift"] as const).map((k) => {
              const l = DEMO.lifts.find((x) => x.liftKey === k);
              return (
                <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, padding: "14px 10px", textAlign: "center" }}>
                  <div style={microLabel(12)}>{k}</div>
                  <div style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 26, color: C.green, marginTop: 6 }}>{l?.oneRMKg} kg</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <TabBar active="home" />
    </div>
  );
};
