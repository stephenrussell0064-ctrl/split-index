import { describe, expect, it } from "vitest";
import { kilometreSplits, spokenDuration, splitAnnouncement } from "./km-splits";
import { buildActivityStreams } from "@/lib/analysis/streams";
import { computeSplits } from "@/lib/analysis/splits";
import type { GpsPoint, PauseInterval } from "./gps-track";

/** ~100m of latitude per step at these coordinates. */
const LAT_STEP_100M = 0.0009;

/** A straight northward track: `steps` fixes 100m apart, `secondsPerStep` apart in time, starting at `startedAt`. */
function track(steps: number, secondsPerStep: number, startedAt = 0): GpsPoint[] {
  return Array.from({ length: steps }, (_, i) => ({
    latitude: 51.5 + LAT_STEP_100M * i,
    longitude: -0.12,
    accuracy: 5,
    altitude: null,
    time: startedAt + i * secondsPerStep * 1000,
  }));
}

describe("kilometreSplits", () => {
  it("is empty before the first kilometre is complete", () => {
    expect(kilometreSplits(track(9, 30), [], 0)).toEqual([]);
  });

  it("produces one split per completed kilometre at a steady pace, with the total accumulating", () => {
    // 2.5km at 5:00/km.
    const splits = kilometreSplits(track(26, 30), [], 0);
    expect(splits.map((s) => s.km)).toEqual([1, 2]);
    for (const split of splits) {
      expect(split.splitSeconds).toBeCloseTo(300, -1);
    }
    expect(splits[1].elapsedSeconds).toBeCloseTo(600, -1);
    expect(splits[1].elapsedSeconds).toBeCloseTo(splits[0].elapsedSeconds + splits[1].splitSeconds, 5);
  });

  it("interpolates the crossing inside the leg rather than snapping to the next fix", () => {
    // Fixes 100m apart but the haversine legs are ~100.1m, so the 1km mark
    // lands a little before the 11th fix. At 30s per leg the honest split is
    // a fraction under 300s; snapping to the fix after would report 300 flat.
    const splits = kilometreSplits(track(12, 30), [], 0);
    expect(splits).toHaveLength(1);
    expect(splits[0].splitSeconds).toBeLessThan(300);
    expect(splits[0].splitSeconds).toBeGreaterThan(295);
  });

  it("measures elapsed from the run's clock origin, not from the first fix", () => {
    // Start pressed 20s before the receiver produced its first fix.
    const startedAt = 0;
    const splits = kilometreSplits(track(12, 30, 20_000), [], startedAt);
    expect(splits[0].elapsedSeconds).toBeGreaterThan(315);
    expect(splits[0].elapsedSeconds).toBeLessThan(321);
  });

  it("excludes paused time from both the split and the total, and does not cross a boundary on the leg spanning a pause", () => {
    const before = track(6, 30); // 0..500m, 0..150s
    // Five minutes standing still, then the run resumes 100m further on.
    const pause: PauseInterval[] = [{ startTime: 150_000, endTime: 450_000 }];
    const after: GpsPoint[] = Array.from({ length: 8 }, (_, i) => ({
      latitude: 51.5 + LAT_STEP_100M * (6 + i),
      longitude: -0.12,
      accuracy: 5,
      altitude: null,
      time: 450_000 + i * 30_000,
    }));
    const splits = kilometreSplits([...before, ...after], pause, 0);
    // 500m before the pause; the 100m leg across it is not counted, so 1km
    // completes on the 5th leg after the resume, just under 600s of wall
    // clock. The 300s pause is not the run's, so the split is ~300s.
    expect(splits).toHaveLength(1);
    expect(splits[0].splitSeconds).toBeLessThan(301);
    expect(splits[0].splitSeconds).toBeGreaterThan(295);
    expect(splits[0].elapsedSeconds).toBeCloseTo(splits[0].splitSeconds, 5);
  });

  it("ignores fixes too inaccurate to trust, same as the distance tile does", () => {
    const points = track(12, 30);
    // A wild fix 5km away would otherwise complete several kilometres at once.
    points.splice(5, 0, { latitude: 51.55, longitude: -0.12, accuracy: 500, altitude: null, time: 135_000 });
    const splits = kilometreSplits(points, [], 0);
    expect(splits).toHaveLength(1);
  });
});

/**
 * The app cuts a run into kilometres TWICE, for two jobs that cannot share
 * one call: this module does it live, from raw fixes, several times a minute
 * while the phone is locked, and lib/analysis/splits.ts does it once at save
 * time from the built stream, with heart rate, cadence and climb per split.
 *
 * Two implementations of "where does kilometre 3 end" is exactly the kind of
 * divergence this codebase keeps getting bitten by, so they are pinned
 * together here. They already share the distance definition
 * (cumulativeTrackDistances); this is the assertion that they also agree on
 * the time, and that the one number they legitimately differ on differs for
 * the one reason it is allowed to.
 */
describe("agreement with the saved-activity split table", () => {
  const points = track(26, 30, 1_700_000_000_000);
  const streams = buildActivityStreams({ points, pauses: [], hrReadings: [], cadenceSamples: [] })!;

  it("gives each kilometre the same time as the saved split table does", () => {
    const live = kilometreSplits(points, [], points[0].time);
    const saved = computeSplits(streams, 1000).filter((s) => !s.isPartial);

    expect(live).toHaveLength(saved.length);
    for (let i = 0; i < live.length; i++) {
      expect(live[i].splitSeconds).toBeCloseTo(saved[i].elapsedSeconds, 0);
    }
  });

  it("differs on the running total by exactly the wait for the first fix, and by nothing else", () => {
    // Start pressed 20s before the receiver produced a fix. The spoken total
    // counts from Start, because that is what the athlete is watching on the
    // HUD; the saved table counts from the first fix, because that is where
    // the saved duration starts. Both are right for their own screen, and the
    // gap between them is that delay — never anything else.
    const startedAt = points[0].time - 20_000;
    const live = kilometreSplits(points, [], startedAt);
    const saved = computeSplits(streams, 1000).filter((s) => !s.isPartial);

    for (let i = 0; i < live.length; i++) {
      expect(live[i].elapsedSeconds - saved[i].cumulativeSeconds).toBeCloseTo(20, 0);
    }
  });
});

describe("spokenDuration", () => {
  it("speaks minutes and seconds in words", () => {
    expect(spokenDuration(312)).toBe("5 minutes 12 seconds");
  });

  it("drops zero components except when there is nothing else to say", () => {
    expect(spokenDuration(300)).toBe("5 minutes");
    expect(spokenDuration(48)).toBe("48 seconds");
    expect(spokenDuration(0)).toBe("0 seconds");
  });

  it("uses singular units and includes hours", () => {
    expect(spokenDuration(3661)).toBe("1 hour 1 minute 1 second");
  });
});

describe("splitAnnouncement", () => {
  it("says the first kilometre's time once, since it is also the total", () => {
    expect(splitAnnouncement({ km: 1, splitSeconds: 312, elapsedSeconds: 312 })).toBe(
      "1 kilometre. 5 minutes 12 seconds."
    );
  });

  it("says how many kilometres are in, the last split, and the total", () => {
    expect(splitAnnouncement({ km: 3, splitSeconds: 305, elapsedSeconds: 927 })).toBe(
      "3 kilometres. Last kilometre 5 minutes 5 seconds. Total 15 minutes 27 seconds."
    );
  });
});
