/**
 * Injury status — user feedback: "I want this to be a status available to put
 * on your social profile to inform others that you are injured."
 *
 * DELIBERATELY COARSE
 * -------------------
 * Two values. That is the whole vocabulary, and keeping it that small is the
 * feature, not a first cut waiting to be enriched.
 *
 * "Injured" and "Returning from injury" are enough to explain a quiet training
 * week to friends, which is the entire job. A body region, a diagnosis, a
 * severity, a date, or a free-text box would each make this a health record
 * attached to a real name and a public username — a different thing, with
 * different consequences if it leaks, sitting in a table whose SELECT policy
 * is `USING (username IS NOT NULL)`. The less this holds, the less there is to
 * regret.
 *
 * INDEPENDENT OF THE HYBRID PLAN, ON PURPOSE
 * ------------------------------------------
 * The Hybrid Plan collects its own, finer-grained injury input (niggle /
 * small / significant, plus body region) so it can program around it. Nothing
 * in this module reads it, and nothing may ever copy it into
 * `profiles.injury_status`. Telling a training tool you have a sore knee is
 * not consent to tell everyone who can see your profile. The only way this
 * status is ever set is the athlete choosing it themselves, in one control
 * that does nothing else.
 *
 * See migration 053 for the column and the same rules stated at the database.
 */

export type InjuryStatus = "injured" | "returning";

/**
 * The complete vocabulary, matching the CHECK constraint in migration 053.
 * These two arrays must not drift: a value the database accepts but this
 * module doesn't know is a badge that renders as nothing, and a value this
 * module offers but the database rejects is a save that fails.
 */
export const INJURY_STATUSES: readonly InjuryStatus[] = ["injured", "returning"] as const;

export const INJURY_STATUS_LABELS: Record<InjuryStatus, string> = {
  injured: "Injured",
  returning: "Returning from injury",
};

/**
 * Short form for tight spots — a friends-list row, an avatar-adjacent chip —
 * where the full label would wrap. Same meaning, fewer characters; never a
 * different or vaguer claim.
 */
export const INJURY_STATUS_SHORT_LABELS: Record<InjuryStatus, string> = {
  injured: "Injured",
  returning: "Returning",
};

/**
 * Reads a stored value, and returns null for anything this app does not
 * recognise.
 *
 * Failing closed matters more here than the type-narrowing does. The database
 * constraint should make an unknown value impossible, but if one ever exists —
 * a hand-edited row, a constraint dropped in some future migration, a column
 * reused for something else — the alternative to returning null is rendering
 * whatever string it holds next to an athlete's name, on a profile other
 * people read. An unrecognised value means "we don't know what this is", and
 * the honest rendering of that is nothing at all.
 */
export function parseInjuryStatus(raw: unknown): InjuryStatus | null {
  return typeof raw === "string" && (INJURY_STATUSES as readonly string[]).includes(raw)
    ? (raw as InjuryStatus)
    : null;
}

export function injuryStatusLabel(status: InjuryStatus): string {
  return INJURY_STATUS_LABELS[status];
}

export function injuryStatusShortLabel(status: InjuryStatus): string {
  return INJURY_STATUS_SHORT_LABELS[status];
}
