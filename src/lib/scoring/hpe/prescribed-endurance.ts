/**
 * An endurance prescription, read back as the fields the cardio log form
 * takes — the endurance half of what `prescribed-sets.ts` does for lifts.
 *
 * WHY THIS EXISTS. A lift prescribed by the Hybrid Plan could be logged from
 * the plan in one tap, or opened in the Lab with every set filled. A run could
 * not: the activities route kept the plan link only for gym sessions, the day
 * card offered endurance sessions nothing, and the log page prefilled nothing
 * from them. So the plan's own long run, however exactly it was run, could
 * never be shown as done — the only control left was the three-button "how
 * did it go", and only once the day had arrived.
 *
 * The stored row carries `kind`, `minutes`, `distance_km` and the
 * prescription text; the sport is not stored. It is the first word of the
 * prescription, which the modality layer writes as a verb — "Swim 0.5km in
 * 25min…", "Ride 25min at a conversational effort", "Row …" — and a running
 * prescription opens with the distance. Reading it back from the text rather
 * than adding a column keeps every plan stored so far loggable.
 */
import type { SessionType, SportType } from "@/types";

export interface StoredEnduranceSession {
  id: string;
  kind: string;
  prescription: string;
  minutes: number | null;
  distanceKm: number | null;
}

/** What the log form is opened with. Strings, because that is what the form holds. */
export interface PrescribedEnduranceFields {
  sport: SportType;
  sessionType: SessionType;
  title: string;
  /** Kilometres for running, walking and cycling; metres for the ergs and the pool, as the form expects per sport. */
  distance: string;
  hours: string;
  minutes: string;
  seconds: string;
}

const KIND_TO_SESSION_TYPE: Record<string, SessionType> = {
  easy_run: "easy",
  recovery_run: "recovery",
  long_run: "long",
  threshold_run: "threshold",
  interval_run: "interval",
  rep_run: "interval",
};

const KIND_TITLE: Record<string, string> = {
  easy_run: "Easy run",
  recovery_run: "Recovery run",
  long_run: "Long run",
  threshold_run: "Threshold",
  interval_run: "Intervals",
  rep_run: "Reps",
};

/** The verb the modality layer opens a non-running prescription with, and the sport it means. */
const VERB_TO_SPORT: [RegExp, SportType][] = [
  [/^swim\b/i, "swimming"],
  [/^row\b/i, "rowing"],
  [/^ride\b/i, "outdoor_cycling"],
  [/^walk\b/i, "walking"],
  [/^ski\b/i, "ski_erg"],
];

const SPORT_NOUN: Partial<Record<SportType, string>> = {
  swimming: "swim",
  rowing: "row",
  outdoor_cycling: "ride",
  walking: "walk",
  ski_erg: "ski",
};

/** Sports whose distance field is in metres on the form. */
const METRE_SPORTS: ReadonlySet<SportType> = new Set(["swimming", "rowing", "ski_erg", "bike_erg"]);

export function sportForPrescription(prescription: string): SportType {
  const text = prescription.trim();
  for (const [verb, sport] of VERB_TO_SPORT) if (verb.test(text)) return sport;
  return "running";
}

/** The session's name the way the day card shows it: "Easy run", "Easy swim", "Swim intervals". */
export function titleForPrescription(session: Pick<StoredEnduranceSession, "kind" | "prescription">): string {
  const sport = sportForPrescription(session.prescription);
  const kindTitle = KIND_TITLE[session.kind] ?? session.kind.replace(/_/g, " ");
  if (sport === "running") return kindTitle;
  const noun = SPORT_NOUN[sport] ?? sport;
  if (kindTitle.endsWith(" run")) return `${kindTitle.slice(0, -4)} ${noun}`;
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${kindTitle.toLowerCase()}`;
}

function splitMinutes(totalMinutes: number): { hours: string; minutes: string; seconds: string } {
  const totalSeconds = Math.max(0, Math.round(totalMinutes * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    hours: hours > 0 ? String(hours) : "",
    minutes: String(minutes),
    seconds: String(seconds).padStart(2, "0"),
  };
}

/**
 * The form fields for a stored endurance session. Null when the row has
 * nothing the form could hold — no minutes and no distance is a prescription
 * with nothing to prefill, and the athlete gets a blank form rather than a
 * form full of empty strings claiming to be the plan's.
 */
export function prescribedEnduranceFields(session: StoredEnduranceSession): PrescribedEnduranceFields | null {
  const minutes =
    session.minutes != null && Number.isFinite(session.minutes) && session.minutes > 0 ? session.minutes : null;
  const distanceKm =
    session.distanceKm != null && Number.isFinite(session.distanceKm) && session.distanceKm > 0
      ? session.distanceKm
      : null;
  if (minutes == null && distanceKm == null) return null;

  const sport = sportForPrescription(session.prescription);
  const distance =
    distanceKm == null
      ? ""
      : METRE_SPORTS.has(sport)
        ? String(Math.round(distanceKm * 1000))
        : String(Math.round(distanceKm * 100) / 100);
  const time = minutes == null ? { hours: "", minutes: "", seconds: "" } : splitMinutes(minutes);

  return {
    sport,
    sessionType: KIND_TO_SESSION_TYPE[session.kind] ?? "easy",
    title: titleForPrescription(session),
    distance,
    ...time,
  };
}

/**
 * Whether a logged endurance session met what was prescribed: the distance
 * where there was one, otherwise the time. Nine-tenths is the line — a 7.8km
 * long run against an 8.1km prescription is the session done, and calling it
 * "came up short" would feed `autoregulate` a wrong signal. Null when the
 * prescription has nothing to measure against, in which case the plan says
 * nothing and leaves the three-button answer to the athlete.
 */
export const MET_PRESCRIPTION_SHARE = 0.9;

export function enduranceMetPrescription(
  session: Pick<StoredEnduranceSession, "minutes" | "distanceKm">,
  logged: { distanceMeters: number | null | undefined; durationSeconds: number }
): boolean | null {
  if (session.distanceKm != null && session.distanceKm > 0) {
    if (logged.distanceMeters == null || !(logged.distanceMeters > 0)) return null;
    return logged.distanceMeters >= session.distanceKm * 1000 * MET_PRESCRIPTION_SHARE;
  }
  if (session.minutes != null && session.minutes > 0) {
    return logged.durationSeconds >= session.minutes * 60 * MET_PRESCRIPTION_SHARE;
  }
  return null;
}
