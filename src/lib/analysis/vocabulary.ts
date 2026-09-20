import type { SportType } from "@/types";

/**
 * What to call the session, per sport.
 *
 * The analysis has always worked for every GPS sport — the panel is shown for
 * any non-gym session recorded by the tracker, which is running, walking and
 * outdoor cycling. The words did not follow: every heading and label said
 * "run", so a walk was headed "Run analysis" and a ride was told the best
 * efforts were "inside this run". The maths was right and the copy was wrong,
 * which is the more embarrassing half.
 *
 * One table, so a new GPS sport gets named in a single place rather than in
 * the six strings that used to hardcode "run".
 */
export interface SportVocabulary {
  /** "run", "walk", "ride" — lower case, for mid-sentence use. */
  noun: string;
  /** "Run", "Walk", "Ride" — for a heading. */
  Noun: string;
  /** What the pace-style metric is called: cyclists read speed, everyone else reads pace. */
  rateLabel: "Pace" | "Speed";
}

const VOCABULARY: Partial<Record<SportType, SportVocabulary>> = {
  running: { noun: "run", Noun: "Run", rateLabel: "Pace" },
  walking: { noun: "walk", Noun: "Walk", rateLabel: "Pace" },
  outdoor_cycling: { noun: "ride", Noun: "Ride", rateLabel: "Speed" },
};

/** Falls back to the neutral "session" for anything not GPS-tracked today, so a new sport reads awkwardly rather than wrongly. */
export function sportVocabulary(sport: SportType): SportVocabulary {
  return VOCABULARY[sport] ?? { noun: "session", Noun: "Session", rateLabel: "Pace" };
}

/** True for sports quoted in km/h rather than min/km. */
export function isSpeedBased(sport: SportType): boolean {
  return sportVocabulary(sport).rateLabel === "Speed";
}

/**
 * The band of paces the chart will draw, in seconds per kilometre.
 *
 * This exists because a single band silently deleted half of every ride. The
 * running band's fast end was 100 s/km, which is 36 km/h — an absurd sprint on
 * foot and an ordinary descent on a bike. Every fast stretch of a ride fell
 * outside it and was blanked, so the one part of the ride a cyclist most wants
 * to look at was the part missing from the graph.
 *
 * The bands are deliberately generous. They are here to reject a GPS jump or a
 * stationary athlete, not to judge whether a performance is plausible: 2:00/km
 * is faster than the world record and is still drawn, because a filter that
 * argues with the athlete about their own data is worse than one that lets an
 * outlier through.
 */
export interface PaceBand {
  minSecondsPerKm: number;
  maxSecondsPerKm: number;
}

const RUN_PACE_BAND: PaceBand = {
  /** 2:00/km, about 30 km/h. Faster than any human sustains on foot; beyond this it is a GPS jump. */
  minSecondsPerKm: 120,
  /** 30:00/km, about 2 km/h. Slower than this is standing still, not moving. */
  maxSecondsPerKm: 1800,
};

const RIDE_PACE_BAND: PaceBand = {
  /** 36 s/km, or 100 km/h. Terminal velocity on a road bike; anything quicker is a jump, not a descent. */
  minSecondsPerKm: 36,
  /** 1 km/h — a rider pushing the bike up something steep still belongs on the graph. */
  maxSecondsPerKm: 3600,
};

export function paceBandFor(sport: SportType): PaceBand {
  return isSpeedBased(sport) ? RIDE_PACE_BAND : RUN_PACE_BAND;
}
