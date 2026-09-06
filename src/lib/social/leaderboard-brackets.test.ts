import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGE_BANDS,
  MIN_BRACKET_SIZE,
  WEIGHT_BAND_FLOOR_KG,
  WEIGHT_BAND_WIDTH_KG,
  ageBandFor,
  matchesEffectiveBracket,
  resolveBracket,
  weightBandFor,
  type BracketCandidate,
} from "./leaderboard-brackets";
import { AGE_BRACKETS, WEIGHT_CLASSES } from "./constants";

/**
 * The bracket engine had no test coverage — only a script nothing runs — at the
 * point migration 056 changed what it is fed. Peers used to arrive carrying
 * their exact age and bodyweight so that banding could happen here; they now
 * arrive already banded by the leaderboard_profiles view, because the raw
 * values should never have been leaving the database.
 *
 * That splits one function across two languages, which is a drift risk: if the
 * SQL bands 34 as "35-44" and this file bands it as "25-34", athletes are
 * silently filed into the wrong bracket and nothing anywhere errors. So the
 * first block below holds the SQL and the TypeScript to each other, and the
 * rest cover the widening behaviour that the refactor could have broken.
 */

const MIGRATION = fileURLToPath(
  new URL("../../../supabase/migrations/056_public_projections.sql", import.meta.url)
);

function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function candidate(
  id: string,
  age: number,
  weightKg: number,
  sex: "male" | "female"
): BracketCandidate {
  return {
    userId: id,
    ageBand: ageBandFor(age).label,
    weightBand: weightBandFor(weightKg).label,
    sex,
  };
}

describe("the SQL bands and the TypeScript bands agree", () => {
  it("uses the same fine age boundaries in both places", () => {
    const sql = migrationSql();
    // AGE_BANDS is the source of truth; every upper bound below 65 has to
    // appear as a boundary in the view's CASE, and every label with it.
    for (const band of AGE_BANDS) {
      expect(sql, `age band ${band.label} missing from the view`).toContain(
        `'${band.label}'`
      );
      if (band.max < 999) {
        expect(
          sql,
          `age boundary ${band.max} missing from the view`
        ).toMatch(new RegExp(`eff\\.age <= ${band.max}\\b`));
      }
    }
  });

  it("uses the same coarse age brackets as the scope dropdown", () => {
    const sql = migrationSql();
    for (const bracket of AGE_BRACKETS) {
      expect(sql, `age bracket ${bracket.value} missing`).toContain(`'${bracket.value}'`);
    }
  });

  it("uses the same weight classes as the scope dropdown", () => {
    const sql = migrationSql();
    for (const cls of WEIGHT_CLASSES) {
      expect(sql, `weight class ${cls.value} missing`).toContain(`'${cls.value}'`);
      if (cls.max < 999) {
        expect(sql).toMatch(new RegExp(`p\\.weight_kg < ${cls.max}\\b`));
      }
    }
  });

  it("uses the same weight band floor and width", () => {
    const sql = migrationSql();
    expect(sql).toContain(`'Under ${WEIGHT_BAND_FLOOR_KG}kg'`);
    expect(sql).toMatch(
      new RegExp(`p\\.weight_kg < ${WEIGHT_BAND_FLOOR_KG}\\b`)
    );
    // The view computes 50 + floor((w - 50) / 10) * 10, so both constants have
    // to be the ones this module bands by.
    expect(sql).toContain(
      `(${WEIGHT_BAND_FLOOR_KG} + FLOOR((p.weight_kg - ${WEIGHT_BAND_FLOOR_KG}) / ${WEIGHT_BAND_WIDTH_KG}) * ${WEIGHT_BAND_WIDTH_KG})`
    );
  });

  it("derives age from date_of_birth in preference to the stored snapshot", () => {
    // Migration 016's rule: a stored age goes stale, a date of birth does not.
    // A band computed from the stale column would quietly misfile anyone whose
    // birthday has passed since they last saved their profile.
    expect(migrationSql()).toMatch(/date_part\('year', age\(p\.date_of_birth\)\)/);
  });
});

describe("band matching", () => {
  const effective = {
    sex: "male" as const,
    ageBands: [ageBandFor(28)],
    weightBands: [weightBandFor(83)],
    label: "Male · 25-34 · 80-90kg",
    widenLevel: "exact" as const,
  };

  it("matches a peer in the same bands", () => {
    expect(matchesEffectiveBracket(candidate("a", 30, 84, "male"), effective)).toBe(true);
  });

  it("rejects a peer one weight band away", () => {
    expect(matchesEffectiveBracket(candidate("b", 30, 74, "male"), effective)).toBe(false);
  });

  it("rejects a peer one age band away", () => {
    expect(matchesEffectiveBracket(candidate("c", 40, 84, "male"), effective)).toBe(false);
  });

  it("rejects the other sex", () => {
    expect(matchesEffectiveBracket(candidate("d", 30, 84, "female"), effective)).toBe(false);
  });

  it("excludes a peer whose bands are unknown rather than guessing", () => {
    // A profile with no bodyweight comes back with weight_band NULL. Counting
    // them as a match would inflate every bracket with people who might not be
    // in it; counting them out is the conservative and honest reading.
    expect(
      matchesEffectiveBracket(
        { userId: "e", ageBand: "25-34", weightBand: null, sex: "male" },
        effective
      )
    ).toBe(false);
  });

  it("ignores bands entirely once widened to sex_only", () => {
    expect(
      matchesEffectiveBracket(candidate("f", 60, 120, "male"), {
        ...effective,
        ageBands: [],
        weightBands: [],
        widenLevel: "sex_only",
      })
    ).toBe(true);
  });

  it("matches everyone at global, including a peer with no sex recorded", () => {
    expect(
      matchesEffectiveBracket(
        { userId: "g", ageBand: null, weightBand: null, sex: null },
        { ...effective, sex: null, ageBands: [], weightBands: [], widenLevel: "global" }
      )
    ).toBe(true);
  });
});

describe("widening still works on banded peers", () => {
  const viewer = { age: 28, weightKg: 83, gender: "male" };

  it("stays exact when the exact bracket is populated", () => {
    const peers = Array.from({ length: MIN_BRACKET_SIZE }, (_, i) =>
      candidate(`p${i}`, 28, 83, "male")
    );
    const r = resolveBracket(viewer, peers);
    expect(r?.effective.widenLevel).toBe("exact");
    expect(r?.exact.label).toBe("Male · 25-34 · 80-90kg");
  });

  it("widens weight first, toward the nearer boundary", () => {
    // 83kg sits in the lower half of 80-90, so the adjacent band is 70-80.
    const peers = [
      candidate("me", 28, 83, "male"),
      ...Array.from({ length: MIN_BRACKET_SIZE }, (_, i) =>
        candidate(`w${i}`, 28, 75, "male")
      ),
    ];
    const r = resolveBracket(viewer, peers);
    expect(r?.effective.widenLevel).toBe("weight");
    // The exact bracket is always preserved for display, however far it widened.
    expect(r?.exact.label).toBe("Male · 25-34 · 80-90kg");
  });

  it("falls back to global and asks for invites when nobody is near", () => {
    const r = resolveBracket(viewer, [candidate("me", 28, 83, "male")]);
    expect(r?.effective.widenLevel).toBe("global");
    expect(r?.showInvitePrompt).toBe(true);
  });

  it("returns null when the viewer has not given enough to place them", () => {
    // The viewer's own numbers, not a peer's — an athlete with no bodyweight
    // recorded has no bracket, and gets told so rather than placed in one.
    expect(resolveBracket({ age: 28, weightKg: null, gender: "male" }, [])).toBeNull();
    expect(resolveBracket({ age: null, weightKg: 83, gender: "male" }, [])).toBeNull();
    expect(resolveBracket({ age: 28, weightKg: 83, gender: null }, [])).toBeNull();
  });
});
