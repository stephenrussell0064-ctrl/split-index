/**
 * Leaderboard bracket segmentation (age × sex × weight).
 *
 * Brackets are a social/motivation feature — the Split Index score already
 * normalizes for age, sex, and bodyweight. These groups let athletes compare
 * with peers who look like them, even though the underlying score is fair
 * globally. Bracket ranks will differ from global ranks by design.
 */

export const AGE_BANDS = [
  { min: 0, max: 19, label: "Under 20" },
  { min: 20, max: 24, label: "20-24" },
  { min: 25, max: 34, label: "25-34" },
  { min: 35, max: 44, label: "35-44" },
  { min: 45, max: 54, label: "45-54" },
  { min: 55, max: 64, label: "55-64" },
  { min: 65, max: 999, label: "65+" },
] as const;

/** 10 kg bands — fewer brackets at low user counts. */
export const WEIGHT_BAND_WIDTH_KG = 10;
export const WEIGHT_BAND_FLOOR_KG = 50;

export const SEX_VALUES = ["male", "female"] as const;
export type BracketSex = (typeof SEX_VALUES)[number];

/** Minimum peers before we widen the bracket. */
export const MIN_BRACKET_SIZE = 20;

/**
 * Widening order when a bracket is too small.
 * Weight first (least identity-salient) → age → sex-only → global.
 */
export const WIDEN_ORDER = ["weight", "age", "sex_only", "global"] as const;
export type WidenStep = (typeof WIDEN_ORDER)[number];

export interface AgeBand {
  min: number;
  max: number;
  label: string;
}

export interface WeightBand {
  min: number;
  max: number; // exclusive upper bound; Infinity for open-ended top
  label: string;
}

export interface ExactBracket {
  sex: BracketSex;
  ageBand: AgeBand;
  weightBand: WeightBand;
  /** Always the user's true bracket, even when the ranking view is widened. */
  label: string;
}

export interface EffectiveBracket {
  sex: BracketSex | null;
  ageBands: AgeBand[];
  weightBands: WeightBand[];
  /** Human label for what is currently ranked (may be widened). */
  label: string;
  widenLevel: WidenStep | "exact";
}

export interface BracketResolution {
  exact: ExactBracket;
  effective: EffectiveBracket;
  size: number;
  /** Show invite CTA only at sex-only or global fallback. */
  showInvitePrompt: boolean;
}

/**
 * A peer, as the leaderboard is allowed to see them.
 *
 * This used to carry `age`, `weightKg` and `gender` — the raw values — because
 * banding happened here in TypeScript. That meant every athlete's exact
 * bodyweight had to cross the wire to answer "how many peers are near me",
 * and the policy that made it possible let anyone holding the anon key read
 * the same columns directly (see migration 056).
 *
 * Peers now arrive pre-banded from the leaderboard_profiles view, so the
 * numbers stay in the database. The labels here are the view's, and they must
 * match AGE_BANDS and weightBandFor exactly — leaderboard-brackets.test.ts
 * holds the SQL and this file to each other.
 *
 * Note this is only about OTHER people. The viewer's own age and bodyweight
 * still reach resolveBracket() as numbers, read from their own profiles row,
 * because knowing whether you sit in the upper or lower half of your own band
 * is what decides which way the bracket widens.
 */
export interface BracketCandidate {
  userId: string;
  ageBand: string | null;
  weightBand: string | null;
  sex: string | null;
}

function sexLabel(sex: BracketSex): string {
  return sex === "male" ? "Male" : "Female";
}

export function resolveBracketSex(gender: string | null | undefined): BracketSex | null {
  if (gender === "male" || gender === "female") return gender;
  return null;
}

export function ageBandFor(age: number): AgeBand {
  for (const band of AGE_BANDS) {
    if (age >= band.min && age <= band.max) return band;
  }
  return AGE_BANDS[AGE_BANDS.length - 1];
}

export function weightBandFor(weightKg: number): WeightBand {
  if (weightKg < WEIGHT_BAND_FLOOR_KG) {
    return {
      min: 0,
      max: WEIGHT_BAND_FLOOR_KG,
      label: `Under ${WEIGHT_BAND_FLOOR_KG}kg`,
    };
  }
  const offset = weightKg - WEIGHT_BAND_FLOOR_KG;
  const index = Math.floor(offset / WEIGHT_BAND_WIDTH_KG);
  const min = WEIGHT_BAND_FLOOR_KG + index * WEIGHT_BAND_WIDTH_KG;
  const max = min + WEIGHT_BAND_WIDTH_KG;
  return {
    min,
    max,
    label: `${min}-${max}kg`,
  };
}

export function formatExactBracketLabel(
  sex: BracketSex,
  ageBand: AgeBand,
  weightBand: WeightBand
): string {
  return `${sexLabel(sex)} · ${ageBand.label} · ${weightBand.label}`;
}

function adjacentAgeBand(band: AgeBand, towardHigher: boolean): AgeBand | null {
  const idx = AGE_BANDS.findIndex((b) => b.min === band.min && b.max === band.max);
  if (idx < 0) return null;
  const next = towardHigher ? AGE_BANDS[idx + 1] : AGE_BANDS[idx - 1];
  return next ?? null;
}

function adjacentWeightBand(band: WeightBand, towardHigher: boolean): WeightBand | null {
  if (band.min === 0) {
    return towardHigher ? weightBandFor(WEIGHT_BAND_FLOOR_KG) : null;
  }
  if (towardHigher) {
    return weightBandFor(band.max);
  }
  if (band.min <= WEIGHT_BAND_FLOOR_KG) {
    return {
      min: 0,
      max: WEIGHT_BAND_FLOOR_KG,
      label: `Under ${WEIGHT_BAND_FLOOR_KG}kg`,
    };
  }
  return weightBandFor(band.min - 0.1);
}

function midAge(band: AgeBand): number {
  return (band.min + Math.min(band.max, 80)) / 2;
}

function midWeight(band: WeightBand): number {
  if (!Number.isFinite(band.max)) return band.min + WEIGHT_BAND_WIDTH_KG / 2;
  return (band.min + band.max) / 2;
}

/**
 * Band membership by label rather than by number.
 *
 * The comparison moved from `age >= b.min && age <= b.max` to a label match
 * when peers stopped carrying raw values. It is the same predicate as long as
 * the view's CASE expressions band identically to ageBandFor/weightBandFor,
 * which is what leaderboard-brackets.test.ts exists to guarantee.
 *
 * The empty-bands case keeps its original meaning: no bands means no
 * constraint, which is how the sex-only and global widen levels are expressed.
 */
function matchesBandLabel(label: string | null, bands: { label: string }[]): boolean {
  if (bands.length === 0) return true;
  if (label == null) return false;
  return bands.some((b) => b.label === label);
}

export function matchesEffectiveBracket(
  candidate: BracketCandidate,
  effective: EffectiveBracket
): boolean {
  if (effective.widenLevel === "global") return true;

  const sex = resolveBracketSex(candidate.sex);
  if (effective.sex != null && sex !== effective.sex) return false;

  if (effective.widenLevel === "sex_only") return true;

  if (!matchesBandLabel(candidate.ageBand, effective.ageBands)) return false;
  if (!matchesBandLabel(candidate.weightBand, effective.weightBands)) return false;
  return true;
}

function countInBracket(
  candidates: BracketCandidate[],
  effective: EffectiveBracket
): number {
  return candidates.filter((c) => matchesEffectiveBracket(c, effective)).length;
}

function formatEffectiveLabel(effective: Omit<EffectiveBracket, "label">): string {
  if (effective.widenLevel === "global") return "All athletes";
  const sex = effective.sex ? sexLabel(effective.sex) : "All";
  if (effective.widenLevel === "sex_only") return sex;
  const age =
    effective.ageBands.length === 1
      ? effective.ageBands[0].label
      : effective.ageBands.map((b) => b.label).join(" / ");
  if (effective.weightBands.length === 0) return `${sex} · ${age}`;
  const weight =
    effective.weightBands.length === 1
      ? effective.weightBands[0].label
      : `${effective.weightBands[0].min}-${effective.weightBands[effective.weightBands.length - 1].max}kg`;
  return `${sex} · ${age} · ${weight}`;
}

/**
 * Resolve the user's exact bracket, then widen until MIN_BRACKET_SIZE peers
 * exist (or we hit global). Always keeps the exact label for UI display.
 */
export function resolveBracket(
  user: { age: number | null; weightKg: number | null; gender: string | null },
  candidates: BracketCandidate[]
): BracketResolution | null {
  const sex = resolveBracketSex(user.gender);
  if (sex == null || user.age == null || user.weightKg == null) {
    return null;
  }

  const ageBand = ageBandFor(user.age);
  const weightBand = weightBandFor(user.weightKg);
  const exact: ExactBracket = {
    sex,
    ageBand,
    weightBand,
    label: formatExactBracketLabel(sex, ageBand, weightBand),
  };

  let ageBands: AgeBand[] = [ageBand];
  let weightBands: WeightBand[] = [weightBand];
  let widenLevel: WidenStep | "exact" = "exact";
  let sexOnly = false;
  let global = false;

  const buildEffective = (): EffectiveBracket => {
    const partial = {
      sex: global ? null : sex,
      ageBands: global || sexOnly ? [] : ageBands,
      weightBands: global || sexOnly ? [] : weightBands,
      widenLevel: global
        ? ("global" as const)
        : sexOnly
          ? ("sex_only" as const)
          : widenLevel,
    };
    return { ...partial, label: formatEffectiveLabel(partial) };
  };

  let effective = buildEffective();
  let size = countInBracket(candidates, effective);

  if (size >= MIN_BRACKET_SIZE) {
    return { exact, effective, size, showInvitePrompt: false };
  }

  // Widen weight toward the nearer boundary.
  const weightTowardHigher = user.weightKg >= midWeight(weightBand);
  const nextWeight = adjacentWeightBand(weightBand, weightTowardHigher);
  if (nextWeight) {
    weightBands = weightTowardHigher
      ? [weightBand, nextWeight]
      : [nextWeight, weightBand];
    widenLevel = "weight";
    effective = buildEffective();
    size = countInBracket(candidates, effective);
    if (size >= MIN_BRACKET_SIZE) {
      return { exact, effective, size, showInvitePrompt: false };
    }
  }

  // Widen age toward the nearer boundary.
  const ageTowardHigher = user.age >= midAge(ageBand);
  const nextAge = adjacentAgeBand(ageBand, ageTowardHigher);
  if (nextAge) {
    ageBands = ageTowardHigher ? [ageBand, nextAge] : [nextAge, ageBand];
    widenLevel = "age";
    effective = buildEffective();
    size = countInBracket(candidates, effective);
    if (size >= MIN_BRACKET_SIZE) {
      return { exact, effective, size, showInvitePrompt: false };
    }
  }

  // Sex-only.
  sexOnly = true;
  widenLevel = "sex_only";
  effective = buildEffective();
  size = countInBracket(candidates, effective);
  if (size >= MIN_BRACKET_SIZE) {
    return { exact, effective, size, showInvitePrompt: true };
  }

  // Global fallback.
  global = true;
  widenLevel = "global";
  effective = buildEffective();
  size = countInBracket(candidates, effective);
  return { exact, effective, size, showInvitePrompt: true };
}
