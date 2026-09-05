import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { firstRunStartedAtMs, ingestRuns, type ActivityRow } from "./ingest";

/**
 * Weekly volume must be divided by a window that ends TODAY.
 *
 * `RunLog.dateIdx` counts days from the athlete's first logged run, so
 * `max - min` spans first-run-to-last-run — and cannot see a gap at the end of
 * it. Four runs in one week six weeks ago were divided by one week.
 *
 * Found by rebuilding a real block: the profile reported 125min/week of weekly
 * volume and 55min/week of running while the intake, reading the SAME activity
 * rows over a calendar window, computed 4.7min/week for the on-ramp. The
 * athlete would have seen three-digit volume on the Diagnostic tab and been
 * prescribed a five-minute run on the Plan tab.
 */

const HR = { hrMax: 190, hrRest: 55 } as const;

function run(daysAgo: number, minutes: number, km: number): ActivityRow {
  return {
    sport: "running",
    started_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    duration_seconds: minutes * 60,
    distance_meters: km * 1000,
    avg_heart_rate: 150,
    max_heart_rate: 170,
    avg_cadence: 170,
    session_type: "easy",
    metadata: {},
    is_partial_track: false,
  } as unknown as ActivityRow;
}

describe("weekly volume window", () => {
  // Four 60-minute runs inside one week, then nothing for six weeks.
  const lapsed = [run(49, 60, 10), run(47, 60, 10), run(45, 60, 10), run(43, 60, 10)];

  it("divided a whole training history by a single week when the athlete had stopped", () => {
    // The old behaviour, still the fallback when no window is supplied.
    const profile = diagnose(ingestRuns(lapsed), [], {}, HR);
    // 240 minutes across a 6-day span, floored at one week.
    expect(profile.runningVolumeMin).toBeCloseTo(240, 0);
  });

  it("counts the weeks the athlete did nothing", () => {
    const weeks = (Date.now() - firstRunStartedAtMs(lapsed)!) / (7 * 86_400_000);
    const profile = diagnose(ingestRuns(lapsed), [], {}, { ...HR, observationWeeks: weeks });

    // 240 minutes across the ~7 weeks since the first of them.
    expect(profile.runningVolumeMin).toBeLessThan(40);
    expect(profile.runningVolumeMin).toBeGreaterThan(30);
  });

  it("does not understate an athlete who has only just started", () => {
    // The opposite error, and the reason the window is not simply the full
    // 12-week history: three weeks of consistent training divided by twelve
    // would report a quarter of what they actually run.
    const newcomer = [run(18, 60, 10), run(14, 60, 10), run(9, 60, 10), run(4, 60, 10)];
    const weeks = (Date.now() - firstRunStartedAtMs(newcomer)!) / (7 * 86_400_000);
    const profile = diagnose(ingestRuns(newcomer), [], {}, { ...HR, observationWeeks: weeks });

    // 240 minutes across ~2.6 weeks — a real 90+ min/week, not 20.
    expect(profile.runningVolumeMin).toBeGreaterThan(80);
  });

  it("moves volume adequacy with it, so the emphasis follows the truth", () => {
    // volumeAdequacy feeds the emphasis vector, and chronicLoad (load-intake)
    // seeds the ACWR denominator off runningVolumeMin. Both must inherit the
    // corrected figure or the plan ramps against volume the athlete no longer
    // does.
    const weeks = (Date.now() - firstRunStartedAtMs(lapsed)!) / (7 * 86_400_000);
    const withGap = diagnose(ingestRuns(lapsed), [], {}, { ...HR, observationWeeks: weeks });
    const withoutGap = diagnose(ingestRuns(lapsed), [], {}, HR);

    expect(withGap.volumeAdequacy!).toBeLessThan(withoutGap.volumeAdequacy!);
  });
});
