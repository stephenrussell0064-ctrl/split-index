import { describe, expect, it } from "vitest";
import { METERS_PER_SPLIT, kilometreSplits, spokenDistance, spokenDuration, splitAnnouncement } from "./km-splits";
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
  it("cuts every 500 metres (owner, 17 Oct 2026: splits every 500m rather than 1km)", () => {
    expect(METERS_PER_SPLIT).toBe(500);
  });

  it("is empty before the first split is complete", () => {
    expect(kilometreSplits(track(4, 30), [], 0)).toEqual([]);
  });

  it("produces one split per completed 500 metres at a steady pace, with the total accumulating", () => {
    // 2.5km at 5:00/km — five half-kilometre splits of 150s.
    const splits = kilometreSplits(track(26, 30), [], 0);
    expect(splits.map((s) => s.meters)).toEqual([500, 1000, 1500, 2000, 2500]);
    expect(splits.map((s) => s.km)).toEqual([0.5, 1, 1.5, 2, 2.5]);
    for (const split of splits) {
      expect(split.splitSeconds).toBeCloseTo(150, -1);
    }
    expect(splits[1].elapsedSeconds).toBeCloseTo(300, -1);
    expect(splits[1].elapsedSeconds).toBeCloseTo(splits[0].elapsedSeconds + splits[1].splitSeconds, 5);
  });

  it("interpolates the crossing inside the leg rather than snapping to the next fix", () => {
    // Fixes 100m apart but the haversine legs are ~100.1m, so the 500m mark
    // lands a little before the 6th fix. At 30s per leg the honest split is a
    // fraction under 150s; snapping to the fix after would report 150 flat.
    const splits = kilometreSplits(track(7, 30), [], 0);
    expect(splits).toHaveLength(1);
    expect(splits[0].splitSeconds).toBeLessThan(150);
    expect(splits[0].splitSeconds).toBeGreaterThan(147);
  });

  it("measures elapsed from the run's clock origin, not from the first fix", () => {
    // Start pressed 20s before the receiver produced its first fix.
    const startedAt = 0;
    const splits = kilometreSplits(track(7, 30, 20_000), [], startedAt);
    expect(splits[0].elapsedSeconds).toBeGreaterThan(165);
    expect(splits[0].elapsedSeconds).toBeLessThan(171);
  });

  it("excludes paused time from both the split and the total, and does not cross a boundary on the leg spanning a pause", () => {
    const before = track(4, 30); // 0..300m, 0..90s
    // Five minutes standing still, then the run resumes 100m further on.
    const pause: PauseInterval[] = [{ startTime: 90_000, endTime: 390_000 }];
    const after: GpsPoint[] = Array.from({ length: 5 }, (_, i) => ({
      latitude: 51.5 + LAT_STEP_100M * (4 + i),
      longitude: -0.12,
      accuracy: 5,
      altitude: null,
      time: 390_000 + i * 30_000,
    }));
    const splits = kilometreSplits([...before, ...after], pause, 0);
    // 300m before the pause; the 100m leg across it is not counted, so 500m
    // completes on the 2nd leg after the resume. The 300s pause is not the
    // run's, so the split is ~150s.
    expect(splits).toHaveLength(1);
    expect(splits[0].splitSeconds).toBeLessThan(151);
    expect(splits[0].splitSeconds).toBeGreaterThan(145);
    expect(splits[0].elapsedSeconds).toBeCloseTo(splits[0].splitSeconds, 5);
  });

  it("ignores fixes too inaccurate to trust, same as the distance tile does", () => {
    const points = track(7, 30);
    // A wild fix 5km away would otherwise complete several splits at once.
    points.splice(3, 0, { latitude: 51.55, longitude: -0.12, accuracy: 500, altitude: null, time: 75_000 });
    const splits = kilometreSplits(points, [], 0);
    expect(splits).toHaveLength(1);
  });
});

/**
 * The app cuts a run into splits TWICE, for two jobs that cannot share one
 * call: this module does it live, from raw fixes, several times a minute
 * while the phone is locked, and lib/analysis/splits.ts does it once at save
 * time from the built stream, with heart rate, cadence and climb per split.
 *
 * Two implementations of "where does split 3 end" is exactly the kind of
 * divergence this codebase keeps getting bitten by, so they are pinned
 * together here. They already share the distance definition
 * (cumulativeTrackDistances); this is the assertion that they also agree on
 * the time, and that the one number they legitimately differ on differs for
 * the one reason it is allowed to.
 */
describe("agreement with the saved-activity split table", () => {
  const points = track(26, 30, 1_700_000_000_000);
  const streams = buildActivityStreams({ points, pauses: [], hrReadings: [], cadenceSamples: [] })!;

  it("gives each split the same time as the saved split table does at the same distance", () => {
    const live = kilometreSplits(points, [], points[0].time);
    const saved = computeSplits(streams, METERS_PER_SPLIT).filter((s) => !s.isPartial);

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
    const saved = computeSplits(streams, METERS_PER_SPLIT).filter((s) => !s.isPartial);

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

describe("spokenDistance", () => {
  it("says metres under a kilometre and kilometres from there, with the half as a decimal", () => {
    expect(spokenDistance(500)).toBe("500 metres");
    expect(spokenDistance(1000)).toBe("1 kilometre");
    expect(spokenDistance(1500)).toBe("1.5 kilometres");
    expect(spokenDistance(3000)).toBe("3 kilometres");
  });
});

describe("splitAnnouncement", () => {
  const split = (meters: number, splitSeconds: number, elapsedSeconds: number, avgHr: number | null = null) => ({
    meters,
    km: meters / 1000,
    splitSeconds,
    elapsedSeconds,
    avgHr,
  });

  it("says the first split's time once, since it is also the total", () => {
    expect(splitAnnouncement(split(500, 156, 156))).toBe("500 metres. 2 minutes 36 seconds.");
  });

  it("says how far in, the last 500 metres, and the total", () => {
    expect(splitAnnouncement(split(1500, 152, 463))).toBe(
      "1.5 kilometres. Last 500 metres 2 minutes 32 seconds. Total 7 minutes 43 seconds."
    );
    expect(splitAnnouncement(split(3000, 150, 900))).toBe(
      "3 kilometres. Last 500 metres 2 minutes 30 seconds. Total 15 minutes."
    );
  });

  it("adds the split's average heart rate only when asked, and only when there is one", () => {
    const withHr = split(1000, 150, 300, 158);
    expect(splitAnnouncement(withHr)).toBe("1 kilometre. Last 500 metres 2 minutes 30 seconds. Total 5 minutes.");
    expect(splitAnnouncement(withHr, { includeHeartRate: true })).toBe(
      "1 kilometre. Last 500 metres 2 minutes 30 seconds. Total 5 minutes. Average heart rate 158."
    );
    expect(splitAnnouncement({ ...withHr, avgHr: null }, { includeHeartRate: true })).toBe(
      "1 kilometre. Last 500 metres 2 minutes 30 seconds. Total 5 minutes."
    );
    expect(splitAnnouncement(split(500, 156, 156, 141), { includeHeartRate: true })).toBe(
      "500 metres. 2 minutes 36 seconds. Average heart rate 141."
    );
  });
});

describe("heart rate per split", () => {
  it("averages the readings timestamped inside each split, and is null where there are none", () => {
    // 2.5km at 5:00/km, a reading every 30s: 140 for the first kilometre,
    // 160 for the second, nothing after — so 140 for the first two splits,
    // 160 for the next two, and nothing for the fifth.
    const points = track(26, 30);
    const readings = Array.from({ length: 20 }, (_, i) => ({
      time: i * 30_000 + 15_000,
      bpm: i < 10 ? 140 : 160,
    }));
    const splits = kilometreSplits(points, [], 0, readings);
    expect(splits.map((s) => s.avgHr)).toEqual([140, 140, 160, 160, null]);
    expect(kilometreSplits(points, [], 0).map((s) => s.avgHr)).toEqual([null, null, null, null, null]);
  });

  it("ignores readings of zero, which a strap sends while it is still settling", () => {
    const readings = [
      { time: 30_000, bpm: 0 },
      { time: 60_000, bpm: 150 },
      { time: 90_000, bpm: 154 },
    ];
    expect(kilometreSplits(track(7, 30), [], 0, readings)[0].avgHr).toBe(152);
  });
});
