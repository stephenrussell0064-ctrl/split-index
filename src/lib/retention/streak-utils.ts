import { localDateKeyInTz, resolveTimezone, shiftDateKey } from "@/lib/utils/timezone";

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

  /*
    Walked as CALENDAR days, not as fixed 86 400 000 ms steps.

    Subtracting a day's worth of milliseconds from an instant and then reading
    the local calendar day is only correct while every day is 24 hours long. On
    the morning the clocks go forward the day is 23 hours, so the walk skipped
    one; in autumn it is 25 and the walk repeated one. Measured, in London with
    five consecutive days logged: at 00:30 on 31 March the streak read 4, and
    `seedRetentionNotifications` fires the "streak at risk" push off exactly
    that number — so the app broke the athlete's streak twice a year and then
    sent them a notification about it.
  */
  let streak = 0;
  const startOffset = trainedToday ? 0 : 1;
  for (let i = startOffset; ; i++) {
    if (daySet.has(shiftDateKey(todayKey, -i))) {
      streak += 1;
    } else {
      break;
    }
  }

  const yesterdayKey = shiftDateKey(todayKey, -1);
  const hadStreakYesterday =
    streak > 0 && !trainedToday && daySet.has(yesterdayKey);
  const atRisk = hadStreakYesterday;

  let weeklySessions = 0;
  for (let d = 0; d < 7; d++) {
    if (daySet.has(shiftDateKey(todayKey, -d))) weeklySessions += 1;
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
