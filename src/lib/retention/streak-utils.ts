const DAY_MS = 86400000;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function parseDaySet(activityDates: string[]): Set<string> {
  return new Set(activityDates.map((iso) => iso.slice(0, 10)));
}

/** Consecutive training days ending today or yesterday (today rest allowed). */
export function computeStreakMetrics(
  activityDates: string[],
  referenceDate = new Date()
): {
  streak: number;
  atRisk: boolean;
  trainedToday: boolean;
  weeklySessions: number;
  weeklyTarget: number;
} {
  const daySet = parseDaySet(activityDates);
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  const todayKey = localDateKey(today);
  const trainedToday = daySet.has(todayKey);

  let streak = 0;
  const cursor = new Date(today);
  if (!trainedToday) {
    cursor.setTime(cursor.getTime() - DAY_MS);
  }

  while (daySet.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setTime(cursor.getTime() - DAY_MS);
  }

  const yesterday = new Date(today.getTime() - DAY_MS);
  const hadStreakYesterday =
    streak > 0 && !trainedToday && daySet.has(localDateKey(yesterday));
  const atRisk = hadStreakYesterday;

  const dowMon = (today.getDay() + 6) % 7;
  const weekStart = new Date(today.getTime() - dowMon * DAY_MS);
  let weeklySessions = 0;
  for (let d = 0; d < 7; d++) {
    const key = localDateKey(new Date(weekStart.getTime() + d * DAY_MS));
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
