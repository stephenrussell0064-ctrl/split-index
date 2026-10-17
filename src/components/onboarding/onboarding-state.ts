import { ageFromDateOfBirth } from "@/lib/utils/age";
import { validateDisplayText, validateUsernameFormat } from "@/lib/utils/username";
import type { Gender, ScoringBasis, SportType } from "@/types";

/**
 * Everything about onboarding that is a rule rather than a pixel.
 *
 * Extracted from the flow component so it can be tested without a React
 * renderer, which this project does not have — the same reason
 * `sanitizeOtpInput` lives outside its JSX.
 *
 * THE RULE THE WHOLE REDESIGN HANGS ON
 * ------------------------------------
 * Continue always works. Every step has a default, so an athlete who taps
 * Continue five times with nothing typed gets a working account: a username
 * suggested from their name, the two hybrid sports preselected, and every
 * body measurement left null — which the scoring engines already tolerate
 * (weight falls back to 75 kg, max HR to 190, sex to a documented default
 * flagged `isDefault`), and which the profile form lets them fill in later.
 *
 * The old flow required date of birth, gender, height, weight and a sport
 * before it would save anything. Each of those is a place to bounce.
 */

export type OnboardingStepId = "welcome" | "about" | "sports" | "done";

/**
 * Four steps, the same everywhere. An Apple Health step that prefills the
 * form is built but deliberately not in this list — see the note at the top
 * of onboarding-flow.tsx.
 */
export function buildSteps(): OnboardingStepId[] {
  return ["welcome", "about", "sports", "done"];
}

/** Gym and running — the pair the product is named for. */
export const DEFAULT_SPORTS: readonly SportType[] = ["gym", "running"];

export const LIMITS = {
  age: { min: 13, max: 120 },
  height_cm: { min: 100, max: 250 },
  weight_kg: { min: 30, max: 300 },
  max_hr: { min: 100, max: 230 },
  resting_hr: { min: 30, max: 120 },
} as const;

export interface OnboardingForm {
  username: string;
  avatar_url: string | null;
  date_of_birth: string;
  gender: Gender | "";
  scoring_basis: ScoringBasis | "";
  height_cm: string;
  weight_kg: string;
  max_hr: string;
  resting_hr: string;
  preferred_sports: SportType[];
}

export function emptyForm(seed: Partial<OnboardingForm> = {}): OnboardingForm {
  return {
    username: "",
    avatar_url: null,
    date_of_birth: "",
    gender: "",
    scoring_basis: "",
    height_cm: "",
    weight_kg: "",
    max_hr: "",
    resting_hr: "",
    preferred_sports: [...DEFAULT_SPORTS],
    ...seed,
  };
}

/** "Stephen Russell" → "Stephen"; an email or nothing → null. */
export function firstNameFrom(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (!first || !validateDisplayText(first, { label: "Name" }).valid) return null;
  return first;
}

/**
 * A username the athlete can accept with one tap.
 *
 * From the first name when there is one ("stephen"), else the local part of
 * the email ("stephen.russell0064" → "stephenrussell"), else "athlete". Folded
 * to what `validateUsernameFormat` allows — a letter first, then letters,
 * digits and underscores, 3–20 long — and padded with digits when it comes out
 * too short. The result is a *candidate*: availability is a server question,
 * answered by `nextUsernameCandidate` when the first one is taken.
 */
export function suggestUsername({
  name,
  email,
  random = Math.random,
}: {
  name?: string | null;
  email?: string | null;
  random?: () => number;
}): string {
  // Trailing digits come off an email's local part: "stephen.russell0064" is
  // Stephen, not a username anyone chose.
  const source = firstNameFrom(name) ?? email?.split("@")[0]?.replace(/\d+$/, "") ?? "";
  let base = source
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 16);
  if (base.length === 0) base = "athlete";
  while (base.length < 3) base += digit(random);
  if (!validateUsernameFormat(base).valid) base = `athlete${digit(random)}${digit(random)}`;
  return base;
}

function digit(random: () => number): string {
  return String(Math.floor(random() * 10));
}

/** "stephen" taken → "stephen_48", then "stephen_4831"… always ≤ 20 chars. */
export function nextUsernameCandidate(base: string, attempt: number, random = Math.random): string {
  const suffixLength = Math.min(2 + attempt * 2, 6);
  let suffix = "";
  for (let i = 0; i < suffixLength; i += 1) suffix += digit(random);
  const stem = base.replace(/_\d+$/, "").slice(0, 20 - suffixLength - 1);
  return `${stem}_${suffix}`;
}

function inRange(value: string, { min, max }: { min: number; max: number }): boolean {
  const n = Number(value);
  return value !== "" && !Number.isNaN(n) && n >= min && n <= max;
}

/**
 * Only what has been typed is checked. An empty field is a choice to skip, not
 * an error — the one exception is the username, which the leaderboard needs
 * and which is prefilled so that skipping it still works.
 */
export function validateAbout(form: OnboardingForm, now = new Date()): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.date_of_birth !== "") {
    const age = ageFromDateOfBirth(form.date_of_birth, now);
    // The date picker on iOS opens on today's date, so a stray tap reads as
    // age 0. Say how to skip as well as what is wrong.
    if (age === null || age < LIMITS.age.min || age > LIMITS.age.max)
      errors.date_of_birth = `Enter a date that makes you ${LIMITS.age.min} or over, or clear it to skip`;
  }
  if (form.height_cm !== "" && !inRange(form.height_cm, LIMITS.height_cm))
    errors.height_cm = `Height should be ${LIMITS.height_cm.min}–${LIMITS.height_cm.max} cm`;
  if (form.weight_kg !== "" && !inRange(form.weight_kg, LIMITS.weight_kg))
    errors.weight_kg = `Weight should be ${LIMITS.weight_kg.min}–${LIMITS.weight_kg.max} kg`;
  if (form.max_hr !== "" && !inRange(form.max_hr, LIMITS.max_hr))
    errors.max_hr = `Max heart rate should be ${LIMITS.max_hr.min}–${LIMITS.max_hr.max}`;
  if (form.resting_hr !== "" && !inRange(form.resting_hr, LIMITS.resting_hr))
    errors.resting_hr = `Resting heart rate should be ${LIMITS.resting_hr.min}–${LIMITS.resting_hr.max}`;
  return errors;
}

/** Does the identity answer already settle which comparison tables to use? */
export function genderDeterminesScoringBasis(gender: Gender | ""): boolean {
  return gender === "male" || gender === "female";
}

export interface ProfileUpsert {
  user_id: string;
  display_name: string | null;
  username: string;
  avatar_url: string | null;
  date_of_birth: string | null;
  age: number | null;
  gender: Gender | null;
  scoring_basis: ScoringBasis | null;
  height_cm: number | null;
  weight_kg: number | null;
  max_hr: number | null;
  resting_hr: number | null;
  preferred_sports: SportType[];
  onboarding_completed: true;
}

/**
 * The row onboarding writes. Nullable everywhere the athlete left a blank.
 *
 * `display_name` is NEVER the email address — the provider's name if it has
 * one and it passes the same check a typed name gets, else null, and every
 * render site falls back to the username. See the privacy incident recorded
 * in git history on the previous onboarding flow: an email on the public
 * leaderboard and in shareable PNGs.
 */
export function buildProfilePayload({
  userId,
  form,
  providerName,
  now = new Date(),
}: {
  userId: string;
  form: OnboardingForm;
  providerName: string | null | undefined;
  now?: Date;
}): ProfileUpsert {
  const trimmedProvider = providerName?.trim();
  const age = form.date_of_birth ? ageFromDateOfBirth(form.date_of_birth, now) : null;
  const sports = form.preferred_sports.length > 0 ? form.preferred_sports : [...DEFAULT_SPORTS];
  return {
    user_id: userId,
    display_name:
      trimmedProvider &&
      !trimmedProvider.includes("@") &&
      validateDisplayText(trimmedProvider, { label: "Display name" }).valid
        ? trimmedProvider
        : null,
    username: form.username.trim(),
    avatar_url: form.avatar_url,
    date_of_birth: form.date_of_birth || null,
    age,
    gender: form.gender || null,
    scoring_basis: genderDeterminesScoringBasis(form.gender)
      ? (form.gender as ScoringBasis)
      : form.scoring_basis || null,
    height_cm: form.height_cm ? Number(form.height_cm) : null,
    weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
    // Typed wins; else the age-based estimate the old flow wrote; else null,
    // and the engine's own 190 fallback (engine.ts) does the rest.
    max_hr: form.max_hr ? Number(form.max_hr) : age ? Math.round(220 - age) : null,
    resting_hr: form.resting_hr ? Number(form.resting_hr) : null,
    preferred_sports: sports,
    onboarding_completed: true,
  };
}

/**
 * A preset icon chosen for the athlete, so the leaderboard never shows a
 * blank circle. Seeded from a string the server and the client both know
 * (the email) rather than Math.random — a random pick differed between the
 * server render and hydration, and React reported the mismatch.
 */
export function pickDefaultAvatar<T>(presets: readonly T[], seed: string): T | null {
  if (presets.length === 0) return null;
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return presets[hash % presets.length] ?? null;
}
