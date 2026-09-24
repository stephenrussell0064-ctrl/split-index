/**
 * Alcohol, and what it does to a training week.
 *
 * WHY THIS IS A MODEL AND NOT A LOOKUP
 * ------------------------------------
 * "Two pints" is not a dose. The same two pints are a trivial dose for a 95kg
 * male at lunchtime and a meaningful one for a 52kg female at 11pm the night
 * before a threshold session — because what the body actually sees is grams of
 * ethanol per kilogram of body water, and body water fraction differs by sex
 * and by body composition. Every number this module produces therefore starts
 * from grams of ethanol and the athlete's own size, never from a drink count.
 *
 * WHAT IS ESTIMATED, AND HOW WELL
 * -------------------------------
 * Three separate things, with genuinely different confidence:
 *
 *   1. Grams of ethanol. ARITHMETIC, not estimation — volume x ABV x density.
 *      Only as good as the volume and ABV entered, which is why the presets
 *      carry real UK serving sizes rather than "a beer".
 *
 *   2. Blood alcohol over time (Widmark). A well-established population model
 *      with wide individual variation: absorption rate depends on stomach
 *      contents, elimination rate varies roughly 0.010-0.020 g/dL/h between
 *      people, and both shift with habitual intake. Treat the curve as an
 *      order-of-magnitude guide to "am I still processing this", never as a
 *      measurement.
 *
 *   3. The effect on recovery and on tomorrow's session. The weakest of the
 *      three, and it is a dose-response shape fitted to what the literature
 *      consistently finds rather than a formula anyone has published:
 *        - Ebrahim et al. (2013) on sleep: alcohol suppresses REM and
 *          fragments the second half of the night, dose-dependently. This is
 *          the main route by which a moderate evening dose costs recovery
 *          even when blood alcohol is long gone by morning.
 *        - Parr et al. (2014): ~1.5 g/kg after a training session suppressed
 *          myofibrillar protein synthesis by 24-37%, even when protein was
 *          co-ingested. This is why the strength decrement here is not simply
 *          "you feel rough" — the adaptation itself is blunted.
 *        - Barnes (2014), reviewing male athletes: next-day endurance and
 *          power decrements are real and dose-dependent, large at high doses
 *          (~1 g/kg and above) and small-to-absent at low ones.
 *      The constants below are the shape of that consensus. They are stated as
 *      estimates in the UI and must stay stated as estimates.
 *
 * WHAT THIS IS EXPLICITLY NOT
 * ---------------------------
 * Not a fitness-to-drive tool, and the UI must never let it be read as one.
 * Widmark estimates routinely sit either side of a measured breath test by
 * more than the entire UK drink-drive limit, and a training app is the worst
 * possible place for someone to look for that answer. Not medical advice or a
 * dependency screen either: the weekly-units line points at the UK CMO
 * low-risk guideline because that is a public-health fact worth surfacing
 * beside a running total, not because this module can assess anyone's health.
 */

/** Grams per millilitre of pure ethanol at room temperature. */
const ETHANOL_DENSITY_G_PER_ML = 0.789;

/**
 * A UK unit is defined as 10ml of pure ethanol — a volume, not a mass, which
 * is why this constant is not a round number of grams. A US "standard drink"
 * is 14g, i.e. about 1.8 UK units; the app is UK-first and says units.
 */
export const UK_UNIT_GRAMS_ETHANOL = 10 * ETHANOL_DENSITY_G_PER_ML; // 7.89g

/** UK Chief Medical Officers' low-risk guideline, for men and women alike. */
export const UK_WEEKLY_UNIT_GUIDELINE = 14;

/**
 * Widmark r — the fraction of bodyweight that behaves as the distribution
 * volume for ethanol. Lower means the same drink reaches a higher blood
 * concentration.
 *
 * The male/female split is not social; it tracks body water fraction, which is
 * lower at a given bodyweight when lean mass is lower. `unknown` is the
 * midpoint, used when the athlete has said "other" or "prefer not to say" or
 * has not filled the field in — a deliberate middle error rather than a guess
 * that is confidently wrong in one direction for half the people it is wrong
 * about.
 */
const WIDMARK_R = { male: 0.68, female: 0.55, unknown: 0.615 } as const;

export type AlcoholSex = keyof typeof WIDMARK_R;

/**
 * Elimination, in g/L of blood per hour. Zero-order: the liver clears a
 * roughly fixed amount per hour regardless of how much is in there, which is
 * the reason a big night costs a whole morning and a small one does not.
 *
 * 0.15 g/L/h is the common central estimate (0.015 g/dL/h). The real spread
 * across people is about 0.10-0.20, so every derived "sober by" time is a
 * midpoint with hours of uncertainty either side of it.
 *
 * TWO KNOWN SIMPLIFICATIONS, both in the same direction at low doses:
 * elimination is genuinely Michaelis-Menten and slows as blood alcohol
 * approaches zero, and first-pass gastric metabolism is not modelled at all.
 * Together they mean the tail of a small dose clears slightly faster here than
 * in a real person. It also means the modelled PEAK sits below the
 * instantaneous Widmark figure usually quoted — the liver is already working
 * through the half hour the drink takes to absorb — which is correct, and is
 * why one unit peaks near 0.07 g/L rather than the 0.145 g/L the closed-form
 * equation predicts.
 */
const ELIMINATION_G_PER_L_PER_HOUR = 0.15;

/**
 * Absorption is modelled as a linear ramp over this many minutes per drink
 * rather than as an instant spike.
 *
 * Instant absorption is the textbook Widmark simplification and it produces a
 * visibly wrong curve for the case this app cares most about: four drinks over
 * an evening. It puts the entire peak at the first drink and then declines,
 * when the athlete's actual peak is late in the session. Thirty minutes is a
 * fed-stomach approximation; on an empty stomach it is faster.
 */
const ABSORPTION_MINUTES = 30;

/** Nothing older than this contributes to today's recovery score. */
export const ALCOHOL_LOOKBACK_HOURS = 48;

const MS_PER_HOUR = 3_600_000;

/** A drink as the athlete entered it, or as it came back out of the database. */
export interface DrinkEntry {
  /** When the drink was consumed (not when it was logged). */
  drankAt: Date;
  /** Grams of pure ethanol. Stored, not recomputed — see `gramsOfEthanol`. */
  gramsEthanol: number;
}

export interface DrinkPreset {
  id: string;
  label: string;
  /** Short qualifier shown under the label, e.g. the ABV assumed. */
  detail: string;
  volumeMl: number;
  abvPercent: number;
  /** Grouping for the picker. */
  category: "beer" | "wine" | "spirits" | "other";
}

/**
 * UK serving sizes, at the ABVs a UK drinker actually meets.
 *
 * These exist so that "a pint" means 568ml here and not 473ml, and so that
 * wine is offered at the sizes a pub pours (125/175/250) rather than as a
 * volume nobody can estimate. Every one of them is only a default: the entry
 * form lets the athlete override volume and ABV, and the grams that get stored
 * are computed from whatever they actually submitted.
 */
export const DRINK_PRESETS: DrinkPreset[] = [
  { id: "pint_lager", label: "Pint of lager", detail: "568ml · 4.0%", volumeMl: 568, abvPercent: 4.0, category: "beer" },
  { id: "pint_strong", label: "Pint of IPA / strong lager", detail: "568ml · 5.2%", volumeMl: 568, abvPercent: 5.2, category: "beer" },
  { id: "pint_cider", label: "Pint of cider", detail: "568ml · 4.5%", volumeMl: 568, abvPercent: 4.5, category: "beer" },
  { id: "half_lager", label: "Half of lager", detail: "284ml · 4.0%", volumeMl: 284, abvPercent: 4.0, category: "beer" },
  { id: "bottle_beer", label: "Bottle of beer", detail: "330ml · 4.5%", volumeMl: 330, abvPercent: 4.5, category: "beer" },
  { id: "can_beer", label: "Can of beer", detail: "440ml · 4.5%", volumeMl: 440, abvPercent: 4.5, category: "beer" },
  { id: "wine_small", label: "Small glass of wine", detail: "125ml · 12%", volumeMl: 125, abvPercent: 12, category: "wine" },
  { id: "wine_medium", label: "Medium glass of wine", detail: "175ml · 12%", volumeMl: 175, abvPercent: 12, category: "wine" },
  { id: "wine_large", label: "Large glass of wine", detail: "250ml · 12%", volumeMl: 250, abvPercent: 12, category: "wine" },
  { id: "wine_bottle", label: "Bottle of wine", detail: "750ml · 12%", volumeMl: 750, abvPercent: 12, category: "wine" },
  { id: "prosecco", label: "Glass of prosecco", detail: "125ml · 11%", volumeMl: 125, abvPercent: 11, category: "wine" },
  { id: "spirit_single", label: "Single spirit", detail: "25ml · 40%", volumeMl: 25, abvPercent: 40, category: "spirits" },
  { id: "spirit_double", label: "Double spirit", detail: "50ml · 40%", volumeMl: 50, abvPercent: 40, category: "spirits" },
  { id: "cocktail", label: "Cocktail", detail: "~50ml spirit · 40%", volumeMl: 50, abvPercent: 40, category: "spirits" },
  { id: "rtd", label: "Alcopop / RTD", detail: "275ml · 4.0%", volumeMl: 275, abvPercent: 4.0, category: "other" },
  { id: "low_alcohol", label: "Low-alcohol beer", detail: "330ml · 0.5%", volumeMl: 330, abvPercent: 0.5, category: "other" },
];

export function findPreset(id: string): DrinkPreset | undefined {
  return DRINK_PRESETS.find((p) => p.id === id);
}

/** Volume x ABV x density. The one number here that is arithmetic, not a model. */
export function gramsOfEthanol(volumeMl: number, abvPercent: number, quantity = 1): number {
  return volumeMl * (abvPercent / 100) * ETHANOL_DENSITY_G_PER_ML * quantity;
}

export function gramsToUnits(grams: number): number {
  return grams / UK_UNIT_GRAMS_ETHANOL;
}

export function unitsToGrams(units: number): number {
  return units * UK_UNIT_GRAMS_ETHANOL;
}

export function widmarkR(sex: AlcoholSex): number {
  return WIDMARK_R[sex];
}

/**
 * Map the profile's gender enum onto a Widmark factor.
 *
 * `other` and `prefer_not_to_say` both resolve to the midpoint rather than
 * defaulting to male, which would silently under-estimate blood alcohol for
 * roughly half the people who choose them.
 */
export function sexForWidmark(gender: string | null | undefined): AlcoholSex {
  if (gender === "male") return "male";
  if (gender === "female") return "female";
  return "unknown";
}

export interface BacPoint {
  /** Milliseconds since epoch. */
  t: number;
  /** Blood alcohol in g/L (per mille). Divide by 10 for the g/100ml figure. */
  bacGPerL: number;
}

export interface BacCurve {
  points: BacPoint[];
  peakGPerL: number;
  peakAt: number | null;
  /** First instant at which the estimate reaches zero, or null if it never does within the window. */
  soberAt: number | null;
}

/** Five-minute steps: fine enough to place a peak, cheap enough to run per request. */
const STEP_MINUTES = 5;

/**
 * Simulate blood alcohol forward from the first drink.
 *
 * Stepwise rather than closed-form because elimination is zero-order and
 * clamps at zero: a closed-form "total absorbed minus beta x elapsed" goes
 * negative between drinking episodes and then comes back up wrong when the
 * next drink lands. Stepping and clamping each interval is the only way the
 * second episode starts from zero rather than from a fictional debt.
 */
export function bacCurve(
  drinks: DrinkEntry[],
  bodyweightKg: number,
  sex: AlcoholSex,
  options: { from?: number; until?: number } = {}
): BacCurve {
  const usable = drinks
    .filter((d) => d.gramsEthanol > 0 && Number.isFinite(d.drankAt.getTime()))
    .sort((a, b) => a.drankAt.getTime() - b.drankAt.getTime());

  if (usable.length === 0 || bodyweightKg <= 0) {
    return { points: [], peakGPerL: 0, peakAt: null, soberAt: null };
  }

  const distributionVolume = widmarkR(sex) * bodyweightKg; // litres of body water, near enough
  const start = options.from ?? usable[0].drankAt.getTime();
  const lastDrink = usable[usable.length - 1].drankAt.getTime();
  // Enough runway for the largest plausible session to return to zero.
  const horizon = options.until ?? lastDrink + ALCOHOL_LOOKBACK_HOURS * MS_PER_HOUR;
  const stepMs = STEP_MINUTES * 60_000;

  const points: BacPoint[] = [];
  let bac = 0;
  let peakGPerL = 0;
  let peakAt: number | null = null;
  let soberAt: number | null = null;

  for (let t = start; t <= horizon; t += stepMs) {
    const absorbedThisStep = usable.reduce((sum, drink) => {
      const drinkStart = drink.drankAt.getTime();
      const windowMs = ABSORPTION_MINUTES * 60_000;
      const prior = absorbedFraction(t - stepMs, drinkStart, windowMs);
      const now = absorbedFraction(t, drinkStart, windowMs);
      return sum + drink.gramsEthanol * (now - prior);
    }, 0);

    bac += absorbedThisStep / distributionVolume;
    bac = Math.max(0, bac - (ELIMINATION_G_PER_L_PER_HOUR * stepMs) / MS_PER_HOUR);

    points.push({ t, bacGPerL: bac });
    if (bac > peakGPerL) {
      peakGPerL = bac;
      peakAt = t;
    }
    if (bac <= 0 && t > lastDrink) {
      // Everything after this is a flat zero tail; the chart draws that itself
      // rather than paying for 500 more identical points.
      soberAt = t;
      break;
    }
  }

  return { points, peakGPerL, peakAt, soberAt };
}

function absorbedFraction(t: number, drinkStart: number, windowMs: number): number {
  if (t <= drinkStart) return 0;
  return Math.min(1, (t - drinkStart) / windowMs);
}

/** Estimated blood alcohol at one instant, in g/L. */
export function bacAt(
  drinks: DrinkEntry[],
  bodyweightKg: number,
  sex: AlcoholSex,
  at: Date
): number {
  const curve = bacCurve(drinks, bodyweightKg, sex, { until: at.getTime() });
  const last = curve.points[curve.points.length - 1];
  return last ? last.bacGPerL : 0;
}

// ── Dose-response ────────────────────────────────────────────────────────────

/**
 * Severity of one drinking episode, 0-1, as a function of grams per kilogram.
 *
 * Anchored rather than fitted, because a fitted curve would imply a precision
 * the underlying studies do not have. The anchors are the doses the literature
 * actually tends to use: ~0.5 g/kg is the "moderate social drinking" arm of
 * most sleep studies, ~1.0 g/kg is the "heavy" arm where next-day performance
 * decrements become reliable, and 1.5 g/kg is roughly the Parr protein-
 * synthesis dose. Below 0.15 g/kg — about one unit for most adults — the
 * effect on training is not distinguishable from noise and the curve says so.
 */
const SEVERITY_ANCHORS: readonly [number, number][] = [
  [0, 0],
  [0.15, 0.12],
  [0.3, 0.34],
  [0.5, 0.58],
  [0.8, 0.8],
  [1.2, 0.95],
  [1.5, 1],
];

export function doseSeverity(gramsPerKg: number): number {
  return interpolate(SEVERITY_ANCHORS, Math.max(0, gramsPerKg));
}

function interpolate(anchors: readonly [number, number][], x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** The most an acute episode can take off the recovery score. */
const MAX_ACUTE_PENALTY = 35;
/** The most a sustained weekly intake can take off, on top of the acute hit. */
const MAX_CHRONIC_PENALTY = 10;
/** Acute effect holds flat for this long — it covers the night's sleep. */
const ACUTE_PLATEAU_HOURS = 10;
/** Exponential decay constant applied after the plateau. */
const ACUTE_DECAY_TAU_HOURS = 12;
/**
 * Drinking inside the sleep window costs more than the same dose at lunchtime,
 * because the sleep-architecture disruption is the dominant mechanism and it
 * only applies if there is sleep left to disrupt.
 */
const LATE_NIGHT_MULTIPLIER = 1.15;
const LATE_NIGHT_FROM_HOUR = 21;
const LATE_NIGHT_TO_HOUR = 4;

/**
 * Weekly units to a chronic penalty. Zero at or below half the CMO guideline;
 * the guideline itself is not a cliff, so 14 units does not read as a failure.
 */
const CHRONIC_ANCHORS: readonly [number, number][] = [
  [0, 0],
  [7, 0],
  [14, 3.5],
  [21, 6.5],
  [35, MAX_CHRONIC_PENALTY],
];

export interface AlcoholImpact {
  /** Points deducted from the recovery score, 0-45. */
  penalty: number;
  acutePenalty: number;
  chronicPenalty: number;
  /** Grams per kg of the most recent drinking episode. */
  episodeGramsPerKg: number;
  episodeUnits: number;
  /** Hours since the last drink of that episode, or null when there is none. */
  hoursSinceLastDrink: number | null;
  /** Units logged in the trailing 7 days. */
  weeklyUnits: number;
  /** Estimated blood alcohol right now, g/L. */
  currentBacGPerL: number;
  /** Estimated instant at which blood alcohol reaches zero. */
  soberAt: number | null;
  /** Whether the last drink fell in the 21:00-04:00 window. */
  lateNight: boolean;
  /** One sentence naming the dominant mechanism. */
  explanation: string;
}

export interface AlcoholImpactInput {
  drinks: DrinkEntry[];
  bodyweightKg: number;
  sex: AlcoholSex;
  now?: Date;
  /** IANA zone, so "late night" means late where the athlete was drinking. */
  timeZone?: string;
}

/**
 * Group drinks into episodes separated by a gap this long. Two pints at 7pm
 * and two more at 11pm are one night out; two pints on Friday and two on
 * Sunday are not, and averaging them into a single "dose" would understate
 * both.
 */
const EPISODE_GAP_HOURS = 6;

export function episodesFrom(drinks: DrinkEntry[]): DrinkEntry[][] {
  const sorted = [...drinks].sort((a, b) => a.drankAt.getTime() - b.drankAt.getTime());
  const episodes: DrinkEntry[][] = [];
  for (const drink of sorted) {
    const current = episodes[episodes.length - 1];
    const previous = current?.[current.length - 1];
    if (
      previous &&
      drink.drankAt.getTime() - previous.drankAt.getTime() <= EPISODE_GAP_HOURS * MS_PER_HOUR
    ) {
      current.push(drink);
    } else {
      episodes.push([drink]);
    }
  }
  return episodes;
}

/** Local hour-of-day in an IANA zone, for the late-night test. */
export function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number(hour) % 24;
}

export function computeAlcoholImpact(input: AlcoholImpactInput): AlcoholImpact {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "Europe/London";
  const bodyweightKg = input.bodyweightKg > 0 ? input.bodyweightKg : 75;

  const withinLookback = input.drinks.filter((d) => {
    const age = now.getTime() - d.drankAt.getTime();
    return age >= -MS_PER_HOUR && age <= ALCOHOL_LOOKBACK_HOURS * MS_PER_HOUR;
  });

  const weekAgo = now.getTime() - 7 * 24 * MS_PER_HOUR;
  const weeklyUnits = gramsToUnits(
    input.drinks
      .filter((d) => d.drankAt.getTime() >= weekAgo && d.drankAt.getTime() <= now.getTime())
      .reduce((sum, d) => sum + d.gramsEthanol, 0)
  );
  const chronicPenalty = interpolate(CHRONIC_ANCHORS, weeklyUnits);

  const episodes = episodesFrom(withinLookback);
  const latest = episodes[episodes.length - 1];

  if (!latest) {
    return {
      penalty: round1(chronicPenalty),
      acutePenalty: 0,
      chronicPenalty: round1(chronicPenalty),
      episodeGramsPerKg: 0,
      episodeUnits: 0,
      hoursSinceLastDrink: null,
      weeklyUnits: round1(weeklyUnits),
      currentBacGPerL: 0,
      soberAt: null,
      lateNight: false,
      explanation:
        weeklyUnits > UK_WEEKLY_UNIT_GUIDELINE
          ? `No alcohol in the last 48 hours, but ${round1(weeklyUnits)} units this week is still blunting adaptation.`
          : "No alcohol logged in the last 48 hours.",
    };
  }

  const episodeGrams = latest.reduce((sum, d) => sum + d.gramsEthanol, 0);
  const episodeGramsPerKg = episodeGrams / bodyweightKg;
  const lastDrinkAt = latest[latest.length - 1].drankAt;
  const hoursSinceLastDrink = Math.max(
    0,
    (now.getTime() - lastDrinkAt.getTime()) / MS_PER_HOUR
  );

  const hour = localHour(lastDrinkAt, timeZone);
  const lateNight = hour >= LATE_NIGHT_FROM_HOUR || hour < LATE_NIGHT_TO_HOUR;

  const severity = doseSeverity(episodeGramsPerKg);
  const timeFactor =
    hoursSinceLastDrink <= ACUTE_PLATEAU_HOURS
      ? 1
      : Math.exp(-(hoursSinceLastDrink - ACUTE_PLATEAU_HOURS) / ACUTE_DECAY_TAU_HOURS);

  const acutePenalty =
    severity * MAX_ACUTE_PENALTY * timeFactor * (lateNight ? LATE_NIGHT_MULTIPLIER : 1);

  const curve = bacCurve(latest, bodyweightKg, input.sex);
  const currentBacGPerL = bacAt(latest, bodyweightKg, input.sex, now);

  return {
    penalty: round1(Math.min(MAX_ACUTE_PENALTY + MAX_CHRONIC_PENALTY, acutePenalty + chronicPenalty)),
    acutePenalty: round1(acutePenalty),
    chronicPenalty: round1(chronicPenalty),
    episodeGramsPerKg: Math.round(episodeGramsPerKg * 1000) / 1000,
    episodeUnits: round1(gramsToUnits(episodeGrams)),
    hoursSinceLastDrink: Math.round(hoursSinceLastDrink * 10) / 10,
    weeklyUnits: round1(weeklyUnits),
    currentBacGPerL: Math.round(currentBacGPerL * 1000) / 1000,
    soberAt: curve.soberAt,
    lateNight,
    explanation: explainImpact({
      severity,
      hoursSinceLastDrink,
      currentBacGPerL,
      lateNight,
      weeklyUnits,
      episodeUnits: gramsToUnits(episodeGrams),
    }),
  };
}

function explainImpact(args: {
  severity: number;
  hoursSinceLastDrink: number;
  currentBacGPerL: number;
  lateNight: boolean;
  weeklyUnits: number;
  episodeUnits: number;
}): string {
  const units = round1(args.episodeUnits);
  if (args.currentBacGPerL > 0.05) {
    return `Still clearing ${units} units — blood alcohol is estimated above zero, so your heart rate, coordination and thermoregulation are all still affected.`;
  }
  if (args.severity >= 0.75) {
    return `${units} units is a heavy dose for your bodyweight. Expect suppressed REM sleep, blunted protein synthesis for around 24 hours, and a real decrement in tomorrow's output.`;
  }
  if (args.severity >= 0.45) {
    return args.lateNight
      ? `${units} units late in the evening — enough to fragment the back half of the night, which is where most of your recovery happens.`
      : `${units} units is a moderate dose. Sleep quality and overnight repair take the hit more than tomorrow's raw performance.`;
  }
  if (args.severity > 0) {
    return `${units} units is a light dose — small effect on sleep, minimal effect on tomorrow's session.`;
  }
  return "No measurable dose from the last episode.";
}

// ── Session impact ───────────────────────────────────────────────────────────

export type SessionVerdict = "as_planned" | "reduce_intensity" | "easy_only" | "rest";

export interface SessionImpact {
  verdict: SessionVerdict;
  /** Estimated decrement in endurance performance, percent. */
  endurancePercent: number;
  /** Estimated decrement in strength / power output, percent. */
  strengthPercent: number;
  /** Estimated blood alcohol at the session start, g/L. */
  bacAtSessionGPerL: number;
  hoursBetween: number | null;
  headline: string;
  detail: string;
}

/**
 * Ceilings for the next-day decrement, reached only at the top of the dose
 * curve. Endurance is the larger of the two because dehydration, impaired
 * gluconeogenesis and disrupted thermoregulation all land on the same session;
 * strength loses less acute output but pays more in blunted adaptation, which
 * is a cost the session itself never shows.
 */
const MAX_ENDURANCE_DECREMENT_PERCENT = 11;
const MAX_STRENGTH_DECREMENT_PERCENT = 9;

export function computeSessionImpact(
  impact: AlcoholImpact,
  sessionAt: Date,
  drinks: DrinkEntry[],
  bodyweightKg: number,
  sex: AlcoholSex
): SessionImpact {
  if (impact.hoursSinceLastDrink === null || drinks.length === 0) {
    return {
      verdict: "as_planned",
      endurancePercent: 0,
      strengthPercent: 0,
      bacAtSessionGPerL: 0,
      hoursBetween: null,
      headline: "No alcohol to account for",
      detail: "Nothing logged in the last 48 hours, so this session is scored on training load alone.",
    };
  }

  const bacAtSession = bacAt(drinks, bodyweightKg, sex, sessionAt);
  const severity = doseSeverity(impact.episodeGramsPerKg);

  /*
   * Hours from the LAST DRINK to the session — which is the interval the
   * recovery literature is expressed in, and deliberately not
   * `impact.hoursSinceLastDrink`. That one is measured from "now", so using it
   * here would make the forecast for a session six hours from now identical to
   * the forecast for one happening this minute.
   */
  const lastDrinkMs = Math.max(...drinks.map((d) => d.drankAt.getTime()));
  const hoursBetween = Math.max(0, (sessionAt.getTime() - lastDrinkMs) / MS_PER_HOUR);

  const timeFactor =
    hoursBetween <= ACUTE_PLATEAU_HOURS
      ? 1
      : Math.exp(-(hoursBetween - ACUTE_PLATEAU_HOURS) / ACUTE_DECAY_TAU_HOURS);

  const endurancePercent = round1(severity * MAX_ENDURANCE_DECREMENT_PERCENT * timeFactor);
  const strengthPercent = round1(severity * MAX_STRENGTH_DECREMENT_PERCENT * timeFactor);
  const worst = Math.max(endurancePercent, strengthPercent);

  let verdict: SessionVerdict;
  if (bacAtSession > 0.2) verdict = "rest";
  else if (worst >= 7) verdict = "easy_only";
  else if (worst >= 3) verdict = "reduce_intensity";
  else verdict = "as_planned";

  return {
    verdict,
    endurancePercent,
    strengthPercent,
    bacAtSessionGPerL: Math.round(bacAtSession * 1000) / 1000,
    hoursBetween: Math.round(hoursBetween * 10) / 10,
    headline: SESSION_HEADLINES[verdict],
    detail: sessionDetail(verdict, {
      endurancePercent,
      strengthPercent,
      hoursBetween,
      bacAtSession,
    }),
  };
}

const SESSION_HEADLINES: Record<SessionVerdict, string> = {
  as_planned: "Train as planned",
  reduce_intensity: "Pull the intensity back",
  easy_only: "Easy or technical work only",
  rest: "Don't train on this",
};

function sessionDetail(
  verdict: SessionVerdict,
  args: {
    endurancePercent: number;
    strengthPercent: number;
    hoursBetween: number;
    bacAtSession: number;
  }
): string {
  const gap = `${Math.round(args.hoursBetween)}h after your last drink`;
  switch (verdict) {
    case "rest":
      return `Blood alcohol is still estimated at ${(args.bacAtSession / 10).toFixed(3)} g/100ml at the session start. Heart rate runs high, thermoregulation is impaired and coordination is measurably off — this is an injury risk, not a hard session.`;
    case "easy_only":
      return `${gap}, expect roughly ${args.endurancePercent}% off your endurance output and ${args.strengthPercent}% off peak force. A top-end session will feel disproportionately hard and won't give you the adaptation you paid for. Zone 2, mobility or technique work will.`;
    case "reduce_intensity":
      return `${gap}, expect roughly ${args.endurancePercent}% off endurance and ${args.strengthPercent}% off peak force. Keep the session, drop the target — take 5-10% off your paces or your working weights and call it a win.`;
    case "as_planned":
      return `${gap}, the modelled decrement is under 3% in both domains. Hydrate properly and train as written.`;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
