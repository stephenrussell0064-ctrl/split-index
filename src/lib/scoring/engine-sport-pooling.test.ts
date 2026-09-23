import { describe, expect, it } from "vitest";
import {
  aggregateSideIndex,
  computeIndexes,
  ENGINE_SPORT_ESTABLISHED_SESSIONS,
  type ActivityScore,
} from "./index-engine";
import { buildActivityScores } from "./adapters";

/**
 * The Engine side pools every endurance sport into one ten-session window, and
 * a population score is sport-relative: 103 for a swim means "slow among
 * swimmers", 822 for a run means "fast among runners". Pooling them read a
 * first-ever swim as a statement about the athlete's endurance engine.
 *
 * Measured on the real account that prompted this: one 103 swim and one 289 run
 * cost 39 points between them, while the steady run the athlete actually
 * complained about was worth −2 — removing it made the index go up. The pool
 * was the whole problem.
 *
 * The per-sport-index-blended-by-evidence alternative was tried first and is
 * measurably worse (−19 on the same data), because a sport with one session
 * still produces a full-strength index of its own. The fix is about which
 * sessions are read at all, not how they are weighted.
 */

const day = (n: number) => new Date(Date.UTC(2026, 8, 30 - n)).toISOString();

function engine(
  sport: ActivityScore["sport"],
  score: number,
  offset: number,
  confidence = 0.9
): ActivityScore {
  return { side: "engine", sport, score, confidence, date: day(offset) };
}

describe("a sport the athlete has barely done", () => {
  // Six runs clears the bar; the swim and the row do not.
  const runs = [820, 700, 719, 672, 709, 692].map((s, i) => engine("run", s, i));

  it("is left out once another sport is established", () => {
    const withNoise = [...runs, engine("swim", 103, 6), engine("row", 733, 7)];
    expect(aggregateSideIndex(withNoise, "engine")).toBe(aggregateSideIndex(runs, "engine"));
  });

  it("stops a single beginner session dragging the index down", () => {
    const withSwim = [...runs, engine("swim", 103, 6)];
    // The old behaviour, reproduced by stripping the sports off the rows.
    const pooled = withSwim.map((r) => ({ ...r, sport: null }));
    const before = aggregateSideIndex(pooled, "engine")!;
    const after = aggregateSideIndex(withSwim, "engine")!;
    expect(after).toBeGreaterThan(before);
  });

  it("counts once it reaches the threshold, even when it scores badly", () => {
    const swims = Array.from({ length: ENGINE_SPORT_ESTABLISHED_SESSIONS }, (_, i) =>
      engine("swim", 103, 6 + i)
    );
    const both = [...runs, ...swims];
    expect(aggregateSideIndex(both, "engine")!).toBeLessThan(aggregateSideIndex(runs, "engine")!);
  });

  it("is one short of counting at the threshold minus one", () => {
    const swims = Array.from({ length: ENGINE_SPORT_ESTABLISHED_SESSIONS - 1 }, (_, i) =>
      engine("swim", 103, 6 + i)
    );
    expect(aggregateSideIndex([...runs, ...swims], "engine")).toBe(
      aggregateSideIndex(runs, "engine")
    );
  });
});

describe("nothing is discarded without something better to stand on", () => {
  it("keeps every session when no sport is established", () => {
    // Four runs and one swim — the athlete's index is provisional either way,
    // and dropping a fifth of their data would be loss, not a fix.
    const rows = [
      engine("run", 700, 0),
      engine("run", 690, 1),
      engine("run", 710, 2),
      engine("run", 680, 3),
      engine("swim", 103, 4),
    ];
    const pooled = rows.map((r) => ({ ...r, sport: null }));
    expect(aggregateSideIndex(rows, "engine")).toBe(aggregateSideIndex(pooled, "engine"));
  });

  it("never excludes a row whose sport is unknown", () => {
    const runs = Array.from({ length: 6 }, (_, i) => engine("run", 700, i));
    const unknown = { ...engine("run", 103, 6), sport: null };
    expect(aggregateSideIndex([...runs, unknown], "engine")).not.toBe(
      aggregateSideIndex(runs, "engine")
    );
  });
});

describe("the window is the ten most recent QUALIFYING sessions", () => {
  it("gives back a run that a one-off swim had pushed out of the window", () => {
    // Ten established runs, then one swim logged most recently. Under the old
    // pooling the swim displaced the oldest run; now it displaces nothing.
    const runs = Array.from({ length: 10 }, (_, i) => engine("run", 700 + i, i + 1));
    const withSwim = [engine("swim", 103, 0), ...runs];
    expect(aggregateSideIndex(withSwim, "engine")).toBe(aggregateSideIndex(runs, "engine"));
  });
});

describe("what this must not touch", () => {
  const runs = Array.from({ length: 6 }, (_, i) => engine("run", 700, i));

  it("leaves the Lab side alone — it is not partitioned by sport", () => {
    const lab: ActivityScore[] = Array.from({ length: 6 }, (_, i) => ({
      side: "lab",
      score: 600 + i,
      confidence: 0.9,
      date: day(i),
    }));
    const withEngineNoise = [...lab, ...runs, engine("swim", 103, 9)];
    expect(computeIndexes(withEngineNoise, "hybrid", 0.5).labIndex).toBe(
      computeIndexes(lab, "gym", 0.5).labIndex
    );
  });

  it("counts evidence over the same sessions the index read", () => {
    // The excluded swim must not inflate the Engine side's weight in the
    // Split blend — an evidence figure standing on sessions the index ignored
    // would mis-weight the headline.
    const lab: ActivityScore[] = Array.from({ length: 6 }, (_, i) => ({
      side: "lab",
      score: 600,
      confidence: 0.9,
      date: day(i),
    }));
    const a = computeIndexes([...lab, ...runs], "hybrid", 0.5);
    const b = computeIndexes([...lab, ...runs, engine("swim", 103, 9)], "hybrid", 0.5);
    expect(b.headline).toBe(a.headline);
  });
});

describe("buildActivityScores supplies the sport", () => {
  it("maps engine rows to their benchmark sport and leaves gym without one", () => {
    const scores = buildActivityScores([
      { sport: "running", sport_index: 700, started_at: day(0) },
      { sport: "outdoor_cycling", sport_index: 600, started_at: day(1) },
      { sport: "swimming", sport_index: 103, started_at: day(2) },
      { sport: "gym", sport_index: 800, started_at: day(3) },
    ]);
    expect(scores.map((s) => s.sport)).toEqual(["run", "cycle", "swim", null]);
    expect(scores.map((s) => s.side)).toEqual(["engine", "engine", "engine", "lab"]);
  });
});
