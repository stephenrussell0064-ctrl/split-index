import { describe, expect, it } from "vitest";
import {
  ALCOHOL_LOOKBACK_HOURS,
  bacAt,
  bacCurve,
  computeAlcoholImpact,
  computeSessionImpact,
  DRINK_PRESETS,
  doseSeverity,
  episodesFrom,
  findPreset,
  gramsOfEthanol,
  gramsToUnits,
  sexForWidmark,
  UK_UNIT_GRAMS_ETHANOL,
  type DrinkEntry,
} from "./alcohol";

const HOUR = 3_600_000;

/** A fixed "now" so nothing here depends on when the suite runs. */
const NOW = new Date("2026-09-24T09:00:00.000Z");

function drinkAt(hoursAgo: number, grams: number): DrinkEntry {
  return { drankAt: new Date(NOW.getTime() - hoursAgo * HOUR), gramsEthanol: grams };
}

/** Grams in one UK unit, used to express test doses the way a drinker would. */
function units(n: number): number {
  return n * UK_UNIT_GRAMS_ETHANOL;
}

describe("grams of ethanol", () => {
  it("puts a UK pint of 4% lager at about 2.3 units", () => {
    // The number on every UK pump clip. If this drifts, the presets are wrong.
    const grams = gramsOfEthanol(568, 4);
    expect(gramsToUnits(grams)).toBeCloseTo(2.27, 1);
  });

  it("puts a 175ml glass of 12% wine at about 2.1 units", () => {
    expect(gramsToUnits(gramsOfEthanol(175, 12))).toBeCloseTo(2.1, 1);
  });

  it("puts a 25ml single of 40% spirit at almost exactly one unit", () => {
    // A UK unit is DEFINED as 10ml of ethanol, and 25ml at 40% is exactly that.
    expect(gramsToUnits(gramsOfEthanol(25, 40))).toBeCloseTo(1, 2);
  });

  it("scales with quantity", () => {
    expect(gramsOfEthanol(568, 4, 3)).toBeCloseTo(gramsOfEthanol(568, 4) * 3, 6);
  });

  it("every preset resolves and carries a plausible unit count", () => {
    for (const preset of DRINK_PRESETS) {
      expect(findPreset(preset.id)).toBe(preset);
      const u = gramsToUnits(gramsOfEthanol(preset.volumeMl, preset.abvPercent));
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(10);
    }
  });
});

describe("Widmark factors", () => {
  it("does not default an unstated gender to male", () => {
    // Defaulting to 0.68 would under-estimate blood alcohol for roughly half
    // the people who choose "other" or "prefer not to say".
    expect(sexForWidmark("male")).toBe("male");
    expect(sexForWidmark("female")).toBe("female");
    expect(sexForWidmark("other")).toBe("unknown");
    expect(sexForWidmark("prefer_not_to_say")).toBe("unknown");
    expect(sexForWidmark(null)).toBe("unknown");
  });
});

describe("the blood alcohol curve", () => {
  it("clears one unit in about an hour, peaking below the textbook figure", () => {
    // 7.89g / (0.68 x 80) = 0.145 g/L is the INSTANTANEOUS Widmark value —
    // the number quoted as "one unit raises BAC by about 0.015%". It is a
    // ceiling nobody reaches, because the liver is clearing throughout the
    // half hour it takes to absorb. The modelled peak is therefore roughly
    // half of it, and the dose is gone inside the hour, which is the rule of
    // thumb the theoretical figure is usually deployed to support.
    const curve = bacCurve([drinkAt(0, units(1))], 80, "male", { from: NOW.getTime() });
    expect(curve.peakGPerL).toBeGreaterThan(0.05);
    expect(curve.peakGPerL).toBeLessThan(0.145);
    expect(curve.soberAt).not.toBeNull();
    const hoursToSober = (curve.soberAt! - NOW.getTime()) / HOUR;
    expect(hoursToSober).toBeGreaterThan(0.5);
    expect(hoursToSober).toBeLessThan(1.5);
  });

  it("matches a standard BAC calculator for an evening out", () => {
    // 8 units (63g) over three hours, 80kg male. Widmark less elimination puts
    // this at roughly 0.07 g/100ml on any published calculator; the absorption
    // ramp shades it slightly lower. Anything wildly off this means a constant
    // has been mistyped.
    const evening = [drinkAt(3, units(3)), drinkAt(2, units(3)), drinkAt(1, units(2))];
    const peak = bacCurve(evening, 80, "male").peakGPerL;
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(0.8);
  });

  it("peaks later than the first drink when an evening is spread out", () => {
    // The reason absorption is modelled at all: an instant-absorption Widmark
    // puts the peak at the first drink and declines from there, which is wrong
    // for every real night out.
    const evening = [drinkAt(4, units(2)), drinkAt(3, units(2)), drinkAt(2, units(2))];
    const curve = bacCurve(evening, 80, "male");
    expect(curve.peakAt).not.toBeNull();
    expect(curve.peakAt!).toBeGreaterThan(evening[0].drankAt.getTime() + HOUR);
  });

  it("reaches zero, and later for a bigger dose", () => {
    const small = bacCurve([drinkAt(0, units(2))], 80, "male", { from: NOW.getTime() });
    const large = bacCurve([drinkAt(0, units(10))], 80, "male", { from: NOW.getTime() });
    expect(small.soberAt).not.toBeNull();
    expect(large.soberAt).not.toBeNull();
    expect(large.soberAt!).toBeGreaterThan(small.soberAt!);
  });

  it("gives a lighter, female athlete a higher peak for the same drinks", () => {
    // Same two pints, genuinely different dose. This is the whole reason the
    // feature asks for bodyweight and sex rather than counting drinks.
    const drinks = [drinkAt(0, units(2))];
    const big = bacCurve(drinks, 95, "male", { from: NOW.getTime() }).peakGPerL;
    const small = bacCurve(drinks, 55, "female", { from: NOW.getTime() }).peakGPerL;
    expect(small).toBeGreaterThan(big * 1.8);
  });

  it("does not carry a negative balance from one episode into the next", () => {
    // Closed-form Widmark goes negative between episodes and then resurfaces
    // wrong. Friday's pints must not cancel out Sunday's.
    const friday = drinkAt(40, units(6));
    const sunday = drinkAt(1, units(2));
    const alone = bacAt([sunday], 80, "male", NOW);
    const after = bacAt([friday, sunday], 80, "male", NOW);
    expect(after).toBeCloseTo(alone, 3);
  });

  it("returns zero before the first drink", () => {
    const before = new Date(NOW.getTime() - 5 * HOUR);
    expect(bacAt([drinkAt(0, units(4))], 80, "male", before)).toBe(0);
  });
});

describe("dose severity", () => {
  it("is monotonic in grams per kilogram", () => {
    const doses = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 3];
    const severities = doses.map(doseSeverity);
    for (let i = 1; i < severities.length; i++) {
      expect(severities[i]).toBeGreaterThanOrEqual(severities[i - 1]);
    }
  });

  it("treats one unit as near-noise and a heavy night as near-maximal", () => {
    const oneUnitFor80kg = UK_UNIT_GRAMS_ETHANOL / 80; // ~0.1 g/kg
    expect(doseSeverity(oneUnitFor80kg)).toBeLessThan(0.15);
    expect(doseSeverity(1.0)).toBeGreaterThan(0.85);
  });

  it("never exceeds 1, however much is drunk", () => {
    expect(doseSeverity(10)).toBe(1);
  });
});

describe("episode grouping", () => {
  it("keeps one evening together and separate nights apart", () => {
    const episodes = episodesFrom([
      drinkAt(50, units(3)),
      drinkAt(49, units(3)),
      drinkAt(3, units(2)),
      drinkAt(2, units(2)),
    ]);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toHaveLength(2);
    expect(episodes[1]).toHaveLength(2);
  });
});

describe("the recovery penalty", () => {
  const base = { bodyweightKg: 80, sex: "male" as const, now: NOW, timeZone: "Europe/London" };

  it("is zero with nothing logged", () => {
    const impact = computeAlcoholImpact({ ...base, drinks: [] });
    expect(impact.penalty).toBe(0);
    expect(impact.hoursSinceLastDrink).toBeNull();
  });

  it("is larger for a heavy night than a light one", () => {
    const light = computeAlcoholImpact({ ...base, drinks: [drinkAt(10, units(2))] });
    const heavy = computeAlcoholImpact({
      ...base,
      drinks: [drinkAt(12, units(5)), drinkAt(11, units(5))],
    });
    expect(heavy.penalty).toBeGreaterThan(light.penalty * 2);
  });

  it("decays as the hours pass", () => {
    const drinks = [drinkAt(10, units(8))];
    const fresh = computeAlcoholImpact({ ...base, drinks });
    const stale = computeAlcoholImpact({
      ...base,
      drinks: [drinkAt(40, units(8))],
    });
    expect(stale.penalty).toBeLessThan(fresh.penalty / 2);
  });

  it("ignores drinks older than the lookback window", () => {
    const impact = computeAlcoholImpact({
      ...base,
      drinks: [drinkAt(ALCOHOL_LOOKBACK_HOURS + 5, units(10))],
    });
    expect(impact.acutePenalty).toBe(0);
    expect(impact.hoursSinceLastDrink).toBeNull();
  });

  it("still charges for a heavy week when nothing is recent", () => {
    // The acute hit is gone; the chronic cost of 30 units in seven days is not.
    const drinks = [
      drinkAt(ALCOHOL_LOOKBACK_HOURS + 10, units(10)),
      drinkAt(ALCOHOL_LOOKBACK_HOURS + 30, units(10)),
      drinkAt(ALCOHOL_LOOKBACK_HOURS + 50, units(10)),
    ];
    const impact = computeAlcoholImpact({ ...base, drinks });
    expect(impact.acutePenalty).toBe(0);
    expect(impact.chronicPenalty).toBeGreaterThan(3);
    expect(impact.weeklyUnits).toBeCloseTo(30, 0);
  });

  it("charges the same dose more when it lands in the sleep window", () => {
    // 23:00 local, versus the same dose at 13:00 the same day.
    const night = computeAlcoholImpact({
      ...base,
      now: new Date("2026-09-24T09:00:00.000Z"),
      drinks: [{ drankAt: new Date("2026-09-23T22:00:00.000Z"), gramsEthanol: units(5) }],
    });
    const afternoon = computeAlcoholImpact({
      ...base,
      now: new Date("2026-09-24T09:00:00.000Z"),
      drinks: [{ drankAt: new Date("2026-09-23T12:00:00.000Z"), gramsEthanol: units(5) }],
    });
    expect(night.lateNight).toBe(true);
    expect(afternoon.lateNight).toBe(false);
    // Only compares the dose multiplier, so the time-decay difference between
    // the two is accounted for by the night one being MORE recent as well.
    expect(night.penalty).toBeGreaterThan(afternoon.penalty);
  });

  it("scales with bodyweight, not with drink count", () => {
    const drinks = [drinkAt(10, units(6))];
    const heavyAthlete = computeAlcoholImpact({ ...base, drinks, bodyweightKg: 110 });
    const lightAthlete = computeAlcoholImpact({ ...base, drinks, bodyweightKg: 55 });
    expect(lightAthlete.penalty).toBeGreaterThan(heavyAthlete.penalty);
  });

  it("caps the total deduction", () => {
    const binge = Array.from({ length: 20 }, (_, i) => drinkAt(9 + i * 0.1, units(3)));
    const impact = computeAlcoholImpact({ ...base, drinks: binge });
    expect(impact.penalty).toBeLessThanOrEqual(45);
  });
});

describe("the session forecast", () => {
  const base = { bodyweightKg: 80, sex: "male" as const, now: NOW, timeZone: "Europe/London" };

  it("says train as planned when nothing was drunk", () => {
    const impact = computeAlcoholImpact({ ...base, drinks: [] });
    const session = computeSessionImpact(impact, NOW, [], 80, "male");
    expect(session.verdict).toBe("as_planned");
    expect(session.endurancePercent).toBe(0);
  });

  it("refuses a session the athlete would start still over zero", () => {
    const drinks = [drinkAt(1, units(10))];
    const impact = computeAlcoholImpact({ ...base, drinks });
    const session = computeSessionImpact(impact, new Date(NOW.getTime() + HOUR), drinks, 80, "male");
    expect(session.bacAtSessionGPerL).toBeGreaterThan(0.2);
    expect(session.verdict).toBe("rest");
  });

  it("softens as the session moves further from the last drink", () => {
    const drinks = [drinkAt(8, units(8))];
    const impact = computeAlcoholImpact({ ...base, drinks });
    const soon = computeSessionImpact(impact, new Date(NOW.getTime() + HOUR), drinks, 80, "male");
    const tomorrow = computeSessionImpact(
      impact,
      new Date(NOW.getTime() + 24 * HOUR),
      drinks,
      80,
      "male"
    );
    expect(tomorrow.endurancePercent).toBeLessThan(soon.endurancePercent);
    expect(tomorrow.strengthPercent).toBeLessThan(soon.strengthPercent);
  });

  it("does not report the same decrement for a session now and one tonight", () => {
    // The bug this guards: reading "hours since last drink" (measured from now)
    // as if it were "hours between the drink and the session".
    const drinks = [drinkAt(6, units(6))];
    const impact = computeAlcoholImpact({ ...base, drinks });
    const now = computeSessionImpact(impact, NOW, drinks, 80, "male");
    const later = computeSessionImpact(impact, new Date(NOW.getTime() + 10 * HOUR), drinks, 80, "male");
    expect(later.hoursBetween).toBeGreaterThan(now.hoursBetween!);
    expect(later.endurancePercent).toBeLessThan(now.endurancePercent);
  });

  it("hits endurance harder than strength at the same dose", () => {
    const drinks = [drinkAt(10, units(8))];
    const impact = computeAlcoholImpact({ ...base, drinks });
    const session = computeSessionImpact(impact, new Date(NOW.getTime() + 2 * HOUR), drinks, 80, "male");
    expect(session.endurancePercent).toBeGreaterThan(session.strengthPercent);
  });
});
