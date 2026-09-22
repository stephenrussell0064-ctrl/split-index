import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartTooltipItemStyle,
} from "@/components/analytics/charts";

/**
 * Dark text on dark glass.
 *
 * Reported against the interference radar — hovering "that day" and "next day"
 * on the lifting-vs-cardio charts showed a tooltip whose text could not be
 * read. The tooltip was not broken: it was positioned correctly, it had the
 * right numbers in it, and it was rendering them in a colour nobody had chosen.
 *
 * `chartTooltipStyle` set a near-black background and no `color`, so Recharts
 * used the default that ships with its own white tooltip. Every chart in the
 * app shares that object, so every tooltip had it — the radar is simply where
 * somebody hovered.
 *
 * These assertions are about contrast rather than about a specific hex, so a
 * palette change does not fail them and a regression does.
 */

const COMPONENTS = join(process.cwd(), "src", "components");

/** Rough relative luminance, good enough to tell dark text from light. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return NaN;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []
  );
}

describe("chart tooltips are readable", () => {
  it("sets a colour on the tooltip container at all", () => {
    // The whole defect in one assertion: no colour meant Recharts' own, which
    // is chosen for the white tooltip it ships with, not for this one.
    expect(chartTooltipStyle.color).toBeTruthy();
  });

  it("puts light text on the dark background it also sets", () => {
    const bg = String(chartTooltipStyle.background ?? "");
    expect(luminance(bg.replace(/[^#0-9a-f]/gi, "").slice(0, 7))).toBeLessThan(0.1);
    for (const style of [chartTooltipStyle, chartTooltipLabelStyle, chartTooltipItemStyle]) {
      expect(luminance(String(style.color))).toBeGreaterThan(0.5);
    }
  });

  it("gives the label its own colour, since a label has no series to inherit from", () => {
    expect(chartTooltipLabelStyle.color).toBeTruthy();
    expect(chartTooltipItemStyle.color).toBeTruthy();
  });

  it("leaves no chart using the shared background without the matching text styles", () => {
    // The fix is only worth as much as its coverage: one tooltip left on
    // contentStyle alone is one chart still unreadable, and it would be found
    // by a user rather than here.
    const offenders: string[] = [];
    for (const file of walk(COMPONENTS)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("contentStyle={chartTooltipStyle}")) continue;
      const uses = src.split("contentStyle={chartTooltipStyle}").length - 1;
      const labels = src.split("labelStyle={chartTooltipLabelStyle}").length - 1;
      if (labels < uses) offenders.push(`${file.replace(process.cwd(), "")} (${uses} tooltips, ${labels} labelled)`);
    }
    expect(offenders).toEqual([]);
  });
});
