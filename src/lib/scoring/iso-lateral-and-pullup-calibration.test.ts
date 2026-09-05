import { describe, expect, it } from "vitest";
import { resolveAnchorKey, scoreStrength } from "./split-strength-engine";
import { getAttachmentOptionsByKey } from "./strength/attachments";
import { getExerciseLoadConfig, resolveConfigKey, resolveScoringWeight } from "./weight-entry";
import { COMMON_EXERCISES } from "@/lib/constants/sports";

/**
 * Three reported strength-scoring defects, pinned to the athlete's own
 * numbers. Their bodyweight is ~78kg: Pull Up +30x8 reproduced the reported
 * 72.9 display (729 internal) exactly at that bodyweight, which is what
 * identified it.
 */
const BODYWEIGHT_KG = 78;

/** Scores a set the way the logging form does — through resolveScoringWeight, so the exercise's own load convention applies. */
function scoreLogged(exerciseName: string, loggedWeightKg: number, reps: number, bodyweightKg = BODYWEIGHT_KG) {
  const resolved = resolveScoringWeight(loggedWeightKg, exerciseName, undefined);
  return scoreStrength({
    liftKey: exerciseName,
    exerciseName,
    history: [],
    latestSet: { weightKg: resolved.scoringWeightKg, reps },
    bodyweightKg,
    sex: "male",
    age: 30,
    isPremium: false,
    isBodyweightRelative: resolved.isBodyweightRelative,
    weightEntryMode: resolved.mode,
  });
}

const ISO_LATERAL_EXERCISES = COMMON_EXERCISES.map((e) => e.name).filter((n) =>
  n.toLowerCase().startsWith("iso-lateral")
);

describe("Iso-Lateral High Row — the reported 100kg x 8 = 99.9 case", () => {
  // BAND LOWERED, 780-850 -> 720-800 (measured 754). Stated rather than
  // quietly widened: the estimator correction (strength/one-rm.ts) took ~15%
  // off every accessory-class eight-rep set, this machine included. The
  // anchor itself is untouched, and deliberately so — the iso-lateral family
  // has no Strength Level population data, so its anchors were set by a
  // RELATIVE constraint ("no machine out-scores a comparable barbell lift at
  // the same relative effort") rather than an absolute target. That
  // constraint is preserved exactly, because the barbell lifts moved by the
  // same correction — see the test immediately below, which is the one that
  // actually pins it and which still passes unchanged. The absolute band was
  // only ever a snapshot of where that relative placement landed.
  it("no longer pins the top of the scale: 100/side x 8 scores ~75, not 999", () => {
    const result = scoreLogged("Iso-Lateral High Row", 100, 8);
    expect(result.score).toBeGreaterThan(720);
    expect(result.score).toBeLessThan(800);
    // The specific symptom: an ordinary working set reading as world-class.
    expect(result.score).toBeLessThan(900);
    expect(result.flags).not.toContain("near-record");
  });

  it("does not out-score the athlete's heavy barbell work at comparable effort", () => {
    const machineRow = scoreLogged("Iso-Lateral High Row", 100, 8).score;
    expect(machineRow).toBeLessThan(scoreLogged("Squat", 180, 8).score);
    expect(machineRow).toBeLessThan(scoreLogged("Deadlift", 200, 8).score);
  });

  it("is monotonic in load and stays inside the scale across the realistic machine range", () => {
    const scores = [40, 60, 80, 100, 120, 140].map((w) => scoreLogged("Iso-Lateral High Row", w, 8).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
    expect(scores[scores.length - 1]).toBeLessThan(999);
  });
});

describe("Iso-Lateral family — configuration", () => {
  it("covers every iso-lateral exercise in the catalogue (none left on the generic fallback)", () => {
    expect(ISO_LATERAL_EXERCISES.length).toBeGreaterThan(0);
    for (const name of ISO_LATERAL_EXERCISES) {
      const result = scoreLogged(name, 50, 8);
      expect(result.source, `${name} resolved to a generic anchor`).not.toBe("generic");
      expect(result.flags, `${name} flagged as an estimated generic standard`).not.toContain(
        "estimated-generic-standard"
      );
    }
  });

  it("offers NO attachment options — these are fixed plate-loaded machines with nothing to attach", () => {
    for (const name of ISO_LATERAL_EXERCISES) {
      const key = resolveAnchorKey(name);
      expect(getAttachmentOptionsByKey(key), `${name} (${key}) still offers attachments`).toBeNull();
    }
  });

  it("defaults to per-side entry, with a Total option, normalized against a total-load anchor", () => {
    for (const name of ISO_LATERAL_EXERCISES) {
      const config = getExerciseLoadConfig(name);
      expect(config.defaultConvention, name).toBe("perHand");
      expect(config.allowedConventions, name).toEqual(["perHand", "total"]);
      expect(config.anchorConvention, name).toBe("total");
    }
  });

  it("reads a per-side entry as both sides: 100/side scores the same as 200 entered as total", () => {
    const perSide = scoreStrength({
      liftKey: "Iso-Lateral High Row",
      exerciseName: "Iso-Lateral High Row",
      history: [],
      latestSet: { weightKg: resolveScoringWeight(100, "Iso-Lateral High Row", "per_hand").scoringWeightKg, reps: 8 },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 30,
      isPremium: false,
      weightEntryMode: "per_hand",
    });
    const total = scoreStrength({
      liftKey: "Iso-Lateral High Row",
      exerciseName: "Iso-Lateral High Row",
      history: [],
      latestSet: { weightKg: resolveScoringWeight(200, "Iso-Lateral High Row", "total").scoringWeightKg, reps: 8 },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 30,
      isPremium: false,
      weightEntryMode: "total",
    });
    expect(perSide.score).toBe(total.score);
  });

  it("keeps the scoring-anchor map and the load-convention map in step (a name in one but not the other silently mis-scores)", () => {
    for (const name of ISO_LATERAL_EXERCISES) {
      expect(resolveConfigKey(name), `${name} has no load-convention config`).toBe(resolveAnchorKey(name));
    }
  });

  it("no longer borrows the dumbbell-row anchor — a machine and a dumbbell are not the same lift", () => {
    expect(resolveAnchorKey("Iso-Lateral High Row")).not.toBe("dbRow");
    expect(resolveAnchorKey("Iso-Lateral Shoulder Press")).not.toBe("dbShoulderPress");
    expect(resolveAnchorKey("Iso-Lateral Wide Pulldown")).not.toBe("latPulldown");
  });

  it("resolves Hammer Strength Row, the same machine family under the manufacturer's name", () => {
    expect(resolveAnchorKey("Hammer Strength Row")).toBe("isoLateralRow");
    expect(scoreLogged("Hammer Strength Row", 60, 8).source).not.toBe("generic");
  });
});

describe("Pull Up — the reported +30kg x 8 = 72.9 case", () => {
  // 796 -> 780 with the estimator correction, which lands exactly on the old
  // lower bound and so tripped a strict `toBeGreaterThan(780)`. Bound moved
  // to 770 rather than the assertion inverted: the athlete's stated target
  // was "almost 80" against a reported 72.9, and 78.0 still meets it. The
  // move here is small because bodyweight-relative lifts subtract bodyweight
  // back out — the correction applies to the ~108kg total load, not to the
  // 30kg the athlete logged.
  it("scores ~78, not 72.9: added load is credited on top of bodyweight", () => {
    const result = scoreLogged("Pull Up", 30, 8);
    expect(result.score).toBeGreaterThan(770);
    expect(result.score).toBeLessThan(830);
  });

  it("the same set on the Weighted Pull Up twin scores identically", () => {
    expect(scoreLogged("Weighted Pull Up", 30, 8).score).toBe(scoreLogged("Pull Up", 30, 8).score);
  });

  it("is not scored as though the athlete had lifted 30kg in total", () => {
    // A 30kg barbell row for 8 is a beginner set; a +30kg pull-up for 8 is not.
    expect(scoreLogged("Pull Up", 30, 8).score).toBeGreaterThan(scoreLogged("Barbell Row", 30, 8).score);
  });

  it("still credits a heavier athlete's added load correctly (bodyweight is part of the load, not a penalty)", () => {
    for (const bw of [70, 78, 85, 95]) {
      const result = scoreLogged("Pull Up", 30, 8, bw);
      expect(result.score, `BW ${bw}`).toBeGreaterThan(750);
      expect(result.score, `BW ${bw}`).toBeLessThan(860);
    }
  });

  it("stays monotonic in added load across the whole calisthenics family", () => {
    for (const name of ["Weighted Pull Up", "Weighted Dips", "Weighted Muscle Up", "Weighted Push Up"]) {
      const scores = [0, 10, 20, 30, 40].map((w) => scoreLogged(name, w, 8).score);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i], `${name} at +${[0, 10, 20, 30, 40][i]}kg`).toBeGreaterThan(scores[i - 1]);
      }
    }
  });

  it("leaves bodyweight-only sets untouched (they already used the total-load path)", () => {
    // Guards the addedKg <= 0 branch that an earlier fix corrected — the
    // blend change must not disturb it.
    const result = scoreLogged("Pull Up", 0, 10);
    expect(result.score).toBeGreaterThan(0);
    expect(result.source).not.toBe("generic");
  });
});

describe("resolveLiftAnchor — graceful degradation preserved", () => {
  it("still falls back to the generic anchor rather than throwing on an unknown exercise", () => {
    const result = scoreLogged("Completely Made Up Machine", 50, 8);
    expect(result.source).toBe("generic");
    expect(result.flags).toContain("estimated-generic-standard");
    expect(result.score).toBeGreaterThan(0);
  });
});
