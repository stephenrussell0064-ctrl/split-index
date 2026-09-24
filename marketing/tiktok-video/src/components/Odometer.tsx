/**
 * Odometer digits: every column is a vertical strip 0–9 that rolls to its
 * value, so the number reads as mechanical wheels, not a text swap. Like a
 * real odometer, only the lowest wheel turns continuously; each higher wheel
 * turns only while the wheel below it carries from 9 to 0. Formats like the
 * app's `formatIndex` — one decimal.
 */
import React from "react";
import { FONT } from "../theme";

/** Continuous 0–10 wheel position for the digit at `place` (0 = tenths, 1 = ones, 2 = tens…) of `tenths` (value × 10). */
export const wheelPosition = (tenths: number, place: number): number => {
  const scaled = tenths / Math.pow(10, place); // this place and everything below, as a continuous number
  const digit = Math.floor(scaled) % 10;
  if (place === 0) return scaled % 10; // lowest wheel rolls continuously
  // the wheel below, 0–10 continuous; carry only while it is between 9 and 10
  const below = (scaled - Math.floor(scaled)) * 10;
  const carry = below > 9 ? below - 9 : 0;
  return digit + carry;
};

const Column: React.FC<{ position: number; size: number; color: string }> = ({ position, size, color }) => {
  const v = ((position % 10) + 10) % 10;
  const h = Math.round(size * 1.16);
  return (
    <div style={{ height: h, width: Math.round(size * 0.66), overflow: "hidden", position: "relative", display: "inline-block" }}>
      <div style={{ position: "absolute", left: 0, top: 0, translate: `0px ${-v * h}px` }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => (
          <div
            key={i}
            style={{
              height: h,
              lineHeight: `${h}px`,
              textAlign: "center",
              fontFamily: FONT.display,
              fontWeight: 900,
              fontSize: size,
              letterSpacing: "-0.04em",
              color,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
};

export const Odometer: React.FC<{
  /** Current displayed value on the 0–100 scale, e.g. 55.6 */
  value: number;
  size?: number;
  color?: string;
  /** A CSS `filter` value (drop-shadow) for the glow. */
  glow?: string;
  /** Force width for N integer digits so the block never jumps. */
  intDigits?: number;
}> = ({ value, size = 180, color = "#fafafa", glow = "none", intDigits = 2 }) => {
  const tenths = Math.max(0, value) * 10;
  const h = Math.round(size * 1.16);
  const cols: React.ReactNode[] = [];
  for (let p = intDigits; p >= 1; p--) {
    cols.push(<Column key={`i${p}`} position={wheelPosition(tenths, p)} size={size} color={color} />);
  }
  cols.push(
    <div
      key="dot"
      style={{
        display: "inline-block",
        fontFamily: FONT.display,
        fontWeight: 900,
        fontSize: size,
        lineHeight: `${h}px`,
        height: h,
        color,
        width: Math.round(size * 0.3),
        textAlign: "center",
      }}
    >
      .
    </div>,
  );
  cols.push(<Column key="d" position={wheelPosition(tenths, 0)} size={size} color={color} />);
  return <div style={{ display: "inline-flex", alignItems: "flex-end", marginLeft: Math.round(-size * 0.05), filter: glow }}>{cols}</div>;
};
