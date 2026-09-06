import type { SupabaseClient } from "@supabase/supabase-js";
import { SECTION_FIELDS, type IntakeSection } from "@/lib/scoring/hpe/intake-record";

/**
 * Article 9 explicit consent — the special category health data gate.
 *
 * WHAT IS TIER 2 AND WHAT IS NOT
 * ------------------------------
 * Not all of the data this app holds is the same, and treating it as one blob
 * leads either to over-restriction or to a breach.
 *
 * Tier 1 — ordinary personal data, processed on contract necessity. Logged
 * sets, reps, loads, distances, times, session heart rate, bodyweight entries,
 * age and sex. These are inputs the athlete supplies to obtain the service they
 * are paying for; the scoring engine cannot function without them. The ICO's
 * position is that data becomes health data where it can be used to DETERMINE
 * HEALTH STATUS, and raw training logs do not, on their own, do that.
 *
 * Tier 2 — special category, requiring explicit consent under Article 9(2)(a).
 * The PAR-Q responses, injury history, the low-energy-availability screen and
 * pregnancy status. These exist precisely to determine health status. That is
 * not an interpretation of them; it is what the questions are for.
 *
 * The reasoning is written down here rather than left implicit because it is
 * the kind of judgement that has to be visible if it is ever questioned, and
 * because the next person to add an intake field needs to know which side of
 * the line they are standing on.
 *
 * WHAT REFUSAL COSTS, AND WHAT IT MUST NOT
 * ----------------------------------------
 * Consent is only consent if it is refusable. Refusing this disables the
 * Hybrid Plan Engine and the injury Risk Index. It must not touch anything
 * else: logging, scoring, the Split Index, the leaderboard, the analytics
 * page, social, and the subscription all work exactly as before. That is not a
 * courtesy — a consent that costs you the product you paid for is not freely
 * given, and would not be valid.
 *
 * consent-gate.test.ts asserts that boundary in both directions.
 */

/**
 * The intake sections that are Article 9 data.
 *
 * Derived from SECTION_FIELDS rather than restated, so a field added to the
 * health or fuelling screen is inside the gate the moment it exists. A list
 * copied by hand is a list that goes stale in exactly the direction that
 * matters.
 */
export const TIER2_INTAKE_SECTIONS: readonly IntakeSection[] = ["health", "fuelling"];

/** Every intake column the consent covers. */
export const TIER2_INTAKE_FIELDS: readonly string[] = TIER2_INTAKE_SECTIONS.flatMap(
  (section) => SECTION_FIELDS[section]
);

export function isTier2Section(section: string): boolean {
  return (TIER2_INTAKE_SECTIONS as readonly string[]).includes(section);
}

export const ARTICLE9_CONSENT_KEY = "hpe_health_intake";

/**
 * The exact wording shown, and its version.
 *
 * Bump the version whenever the text changes, however small the change. The
 * version is what makes "which athletes agreed to the current wording"
 * answerable, and a silent edit turns every historical record into a claim
 * about text that was never on screen.
 *
 * Written to be read by the person answering it rather than by a lawyer:
 * plain about what is collected, what it is used for, what refusing costs, and
 * that it can be taken back. Deliberately says the words "health data" — a
 * consent whose subject the athlete has to infer is not explicit.
 */
export const ARTICLE9_CONSENT_VERSION = "2026-09-06.1";

export const ARTICLE9_CONSENT_TEXT = [
  "The Hybrid Plan asks about your health so it can screen you before it programmes anything: whether a doctor has ever told you to be careful exercising, chest pain on exertion, injuries and where they are, surgery in the last six months, pregnancy or the twelve weeks after it, medication that changes your heart rate, and five questions about whether you are eating enough for what you are training.",
  "That is health data, and UK law treats it differently from the rest of what Split Index holds. We can only use it if you explicitly say we can. Ticking this box is that permission.",
  "We use it for one thing: to decide what is safe to prescribe you, and to refuse to prescribe when it is not. It is never shown to other athletes, never put on a leaderboard or a share card, and never sent to an analytics service.",
  "You do not have to agree. If you do not, everything else works exactly as it does now — logging, your Split Index, predictions, the leaderboard, analytics and your subscription are all unaffected. You will not be able to use the Hybrid Plan or the injury Risk Index, because both are built on this screening.",
  "You can take this back at any time from Settings, in one action. When you do, we delete these answers rather than hiding them.",
].join("\n\n");

export interface Article9ConsentState {
  granted: boolean;
  /** When the current state was decided. Null if the athlete has never been asked. */
  decidedAt: string | null;
  /** The version they last acted on — may be older than the current wording. */
  version: string | null;
}

interface ConsentEventRow {
  action: string;
  wording_version: string;
  created_at: string;
}

/**
 * Current consent state: the newest event wins.
 *
 * Fails CLOSED. Any error — a missing table because migration 057 has not been
 * applied, a dropped connection — returns "not granted", so the failure mode
 * of this function is a Hybrid Plan that declines to generate, never a health
 * screen processed without permission.
 */
export async function getArticle9Consent(
  supabase: SupabaseClient,
  userId: string
): Promise<Article9ConsentState> {
  const notGranted: Article9ConsentState = {
    granted: false,
    decidedAt: null,
    version: null,
  };

  try {
    const { data, error } = await supabase
      .from("article9_consent_events")
      .select("action, wording_version, created_at")
      .eq("user_id", userId)
      .eq("consent_key", ARTICLE9_CONSENT_KEY)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return notGranted;

    const row = data as ConsentEventRow;
    return {
      granted: row.action === "granted",
      decidedAt: row.created_at,
      version: row.wording_version,
    };
  } catch {
    return notGranted;
  }
}

/** Convenience for the many call sites that only need the boolean. */
export async function hasArticle9Consent(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await getArticle9Consent(supabase, userId)).granted;
}

/**
 * Record a grant or a withdrawal.
 *
 * Always an INSERT. There is no update path and the table has no UPDATE policy
 * to reach for even if one were written here — see migration 057.
 */
export async function recordArticle9Event(
  supabase: SupabaseClient,
  userId: string,
  action: "granted" | "withdrawn"
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("article9_consent_events").insert({
    user_id: userId,
    action,
    consent_key: ARTICLE9_CONSENT_KEY,
    wording_version: ARTICLE9_CONSENT_VERSION,
    // The text as shown, stored with the event rather than referenced, so this
    // row still answers "what did they agree to" after the constant changes.
    wording_text: ARTICLE9_CONSENT_TEXT,
  });

  return { error: error ? "Could not record your choice. Please try again." : null };
}

/**
 * Strip every Tier 2 field out of an intake payload.
 *
 * Used on the write path so that a client which has not been told about the
 * gate — an old app build, a replayed request — cannot land health answers by
 * sending them inside a section that is otherwise allowed.
 */
export function stripTier2Fields(
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!TIER2_INTAKE_FIELDS.includes(key)) out[key] = value;
  }
  return out;
}
