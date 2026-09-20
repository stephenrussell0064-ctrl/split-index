import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * No competitor named in copy the athlete reads.
 *
 * Three places compared Split Index to Garmin by name — "nobody's model (Garmin
 * included)", "the same way Garmin and every other platform does it". Each was
 * written to be honest about an estimate being an estimate, which is worth
 * keeping; naming a competitor to make that point is not. It invites the
 * comparison, dates badly, and puts another company's trade mark in our
 * product copy to no benefit.
 *
 * Comments are exempt. Several record real provenance — Strava's privacy-zone
 * radius as a reference standard, which paper an elevation model comes from —
 * and stripping those would cost the next reader context and gain nothing,
 * because comments do not ship.
 *
 * ALLOWED names device compatibility, which is a different thing: telling
 * someone their Polar strap will pair is a fact they need, not a comparison.
 * Add to it only for that reason.
 */

const SRC = resolve(__dirname);

/** Brands whose products compete with this app. */
const COMPETITORS = [
  "Garmin",
  "Strava",
  "Whoop",
  "Coros",
  "Suunto",
  "Wahoo",
  "Zwift",
  "Fitbit",
  "Oura",
  "TrainingPeaks",
  "Peloton",
  "Hevy",
  "MyFitnessPal",
];

/**
 * Files allowed to name a brand, and why. Each is device compatibility or a
 * legal disclosure of what the app connects to — never a comparison.
 */
const ALLOWED: Record<string, string> = {
  "app/(app)/cardio/gps-run/gps-run-client.tsx": "which chest straps pair over BLE",
  "app/support/page.tsx": "which chest straps pair over BLE",
};

/*
 * The privacy policy was on this list and did not belong: on main it names no
 * brand at all, describing "heart-rate straps and compatible equipment such as
 * the Concept2 PM5" — a rowing erg, not a competing app. The guard's own
 * honesty check caught the stale entry, which is the case for having it.
 */

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, acc);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) acc.push(full);
  }
  return acc;
}

/** Strip comments — only what renders counts. */
function renderedText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const OFFENDERS = tsxFiles(SRC)
  .map((file) => {
    const rel = relative(SRC, file);
    const hits = COMPETITORS.filter((brand) =>
      new RegExp(`\\b${brand}\\b`, "i").test(renderedText(readFileSync(file, "utf8"))),
    );
    return { rel, hits };
  })
  .filter(({ rel, hits }) => hits.length > 0 && !(rel in ALLOWED));

describe("the guard is looking at the right thing", () => {
  it("scans a meaningful number of components", () => {
    expect(tsxFiles(SRC).length).toBeGreaterThan(50);
  });

  it("would notice a brand name if one were there", () => {
    const planted = renderedText('<p>Estimated the same way Garmin does it.</p>');
    expect(COMPETITORS.some((b) => new RegExp(`\\b${b}\\b`).test(planted))).toBe(true);
  });

  it("does not count a brand that only appears in a comment", () => {
    const commented = renderedText("/* Strava calls these best efforts */\n<p>Best efforts</p>");
    expect(COMPETITORS.some((b) => new RegExp(`\\b${b}\\b`).test(commented))).toBe(false);
  });
});

describe("no competitor is named in what the athlete reads", () => {
  it("finds none outside the compatibility allowlist", () => {
    expect(
      OFFENDERS.map(({ rel, hits }) => `${rel} → ${hits.join(", ")}`),
    ).toEqual([]);
  });
});

describe("the allowlist stays honest", () => {
  it.each(Object.keys(ALLOWED))("%s still names a brand, or should leave the list", (rel) => {
    // An allowlist entry that no longer applies is a licence nobody is using.
    const src = renderedText(readFileSync(join(SRC, rel), "utf8"));
    expect(COMPETITORS.some((b) => new RegExp(`\\b${b}\\b`, "i").test(src))).toBe(true);
  });
});
