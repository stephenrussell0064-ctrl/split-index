/**
 * A CSS-3D iPhone. The body is a rounded slab with a bezel and a Dynamic
 * Island; the screen is whatever children you give it, laid out at
 * SCREEN_W × SCREEN_H (iPhone 15/16 Pro proportions, 1179×2556 scaled).
 *
 * Rotation and scale are props — the scene drives them with springs.
 */
import React from "react";
import { C } from "../theme";

export const PHONE_W = 560;
export const BEZEL = 12;
export const SCREEN_W = PHONE_W - BEZEL * 2; // 536
export const SCREEN_H = Math.round((SCREEN_W * 2556) / 1179); // 1162
export const PHONE_H = SCREEN_H + BEZEL * 2;
export const SCREEN_RADIUS = 66;

export const Phone: React.FC<{
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
  x?: number;
  y?: number;
  /** Glow colour under the phone. */
  glow?: "green" | "blue" | "none";
  children: React.ReactNode;
}> = ({ rotateX = 0, rotateY = 0, rotateZ = 0, scale = 1, x = 0, y = 0, glow = "green", children }) => {
  const glowShadow =
    glow === "green"
      ? "0 60px 160px rgba(61,255,110,0.22)"
      : glow === "blue"
        ? "0 60px 160px rgba(59,166,255,0.22)"
        : "0 60px 160px rgba(0,0,0,0.5)";
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", perspective: 1800 }}>
      <div
        style={{
          width: PHONE_W,
          height: PHONE_H,
          borderRadius: SCREEN_RADIUS + BEZEL,
          background: "linear-gradient(160deg, #1a1a1a 0%, #0a0a0a 45%, #141414 100%)",
          boxShadow: `0 0 0 2px #2a2a2a, inset 0 0 0 1px rgba(255,255,255,0.08), ${glowShadow}, 0 40px 90px rgba(0,0,0,0.7)`,
          padding: BEZEL,
          boxSizing: "border-box",
          transform: `translate(${x}px, ${y}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
          transformStyle: "preserve-3d",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: SCREEN_RADIUS,
            overflow: "hidden",
            background: C.black,
            position: "relative",
          }}
        >
          {children}
          {/* Dynamic Island */}
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              translate: "-50% 0",
              width: 150,
              height: 42,
              borderRadius: 24,
              background: "#000",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          />
        </div>
        {/* edge highlight — the light catching the rim */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: SCREEN_RADIUS + BEZEL,
            pointerEvents: "none",
            background: `linear-gradient(${115 + rotateY * 2}deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 22%, rgba(255,255,255,0) 78%, rgba(255,255,255,0.12) 100%)`,
            mixBlendMode: "screen",
          }}
        />
      </div>
    </div>
  );
};

/** iOS status bar, as the app screenshots show it. */
export const StatusBar: React.FC<{ light?: boolean }> = ({ light }) => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 70,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 34px",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontWeight: 700,
      fontSize: 22,
      color: light ? C.engineText : C.white,
      zIndex: 3,
    }}
  >
    <span>9:41</span>
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ display: "inline-flex", gap: 2, alignItems: "flex-end" }}>
        {[8, 11, 14, 17].map((h) => (
          <span key={h} style={{ width: 4, height: h, background: light ? C.engineText : C.white, borderRadius: 1 }} />
        ))}
      </span>
      <span
        style={{
          width: 34,
          height: 16,
          border: `2px solid ${light ? C.engineText : C.white}`,
          borderRadius: 5,
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        <span style={{ position: "absolute", left: 1, top: 1, bottom: 1, width: "82%", background: light ? C.engineText : C.white, borderRadius: 2 }} />
      </span>
    </span>
  </div>
);

/** The app's bottom tab bar: Home · Lab · (+) · Engine · More. */
export const TabBar: React.FC<{ active: "home" | "lab" | "engine" }> = ({ active }) => {
  const item = (label: string, key: "home" | "lab" | "engine" | "more", icon: React.ReactNode) => (
    <div
      key={key}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        color: active === key ? C.green : C.muted,
        fontFamily: "-apple-system, system-ui, sans-serif",
        fontSize: 15,
        width: 90,
        padding: "8px 0",
        borderRadius: 18,
        background: active === key ? "rgba(255,255,255,0.05)" : "transparent",
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
  const stroke = (k: string) => (active === k ? C.green : C.muted);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 128,
        background: "rgba(6,6,6,0.96)",
        borderTop: `1px solid ${C.cardBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        padding: "0 12px 18px",
        zIndex: 3,
      }}
    >
      {item("Home", "home", (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={stroke("home")} strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ))}
      {item("Lab", "lab", (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={stroke("lab")} strokeWidth="2" strokeLinecap="round">
          <path d="M6 9v6M18 9v6M3 11v2M21 11v2M6 12h12" />
        </svg>
      ))}
      <div style={{ width: 84, height: 84, borderRadius: 42, background: C.green, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 30px rgba(61,255,110,0.45)", marginTop: -26 }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#04120a" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
        </svg>
      </div>
      {item("Engine", "engine", (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={stroke("engine")} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
      ))}
      {item("More", "more", (
        <svg width="28" height="28" viewBox="0 0 24 24" fill={C.muted}>
          <circle cx="6" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="12" r="2" />
        </svg>
      ))}
    </div>
  );
};
