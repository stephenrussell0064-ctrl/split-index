import { localDateKeyInTz, resolveTimezone } from "@/lib/utils/timezone";

const DAY_MS = 86400000;

function parseDaySet(activityDates: string[], timeZone: string): Set<string> {
  return new Set(activityDates.map((iso) => localDateKeyInTz(iso, timeZone)));
}

/** Consecutive training days ending today or yesterday (today rest allowed). */
export function computeStreakMetrics(
  activityDates: string[],
  referenceDate = new Date(),
  profileTimezone?: string | null
): {
  streak: number;
  atRisk: boolean;
  trainedToday: boolean;
  weeklySessions: number;
  weeklyTarget: number;
} {
  const timeZone = resolveTimezone(profileTimezone);
  const daySet = parseDaySet(activityDates, timeZone);
  const todayKey = localDateKeyInTz(referenceDate, timeZone);
  const trainedToday = daySet.has(todayKey);

  let streak = 0;
  const startOffset = trainedToday ? 0 : 1;
  for (let i = startOffset; ; i++) {
    const probe = new Date(referenceDate.getTime() - i * DAY_MS);
    const key = localDateKeyInTz(probe, timeZone);
    if (daySet.has(key)) {
      streak += 1;
    } else {
      break;
    }
  }

  const yesterdayProbe = new Date(referenceDate.getTime() - DAY_MS);
  const yesterdayKey = localDateKeyInTz(yesterdayProbe, timeZone);
  const hadStreakYesterday =
    streak > 0 && !trainedToday && daySet.has(yesterdayKey);
  const atRisk = hadStreakYesterday;

  let weeklySessions = 0;
  for (let d = 0; d < 7; d++) {
    const probe = new Date(referenceDate.getTime() - d * DAY_MS);
    const key = localDateKeyInTz(probe, timeZone);
    if (daySet.has(key)) weeklySessions += 1;
  }

  return {
    streak,
    atRisk,
    trainedToday,
    weeklySessions,
    weeklyTarget: 4,
  };
}

export function isMilestoneStreak(streak: number): boolean {
  return [3, 7, 14, 30].includes(streak);
}
