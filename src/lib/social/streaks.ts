/** Consecutive calendar days with at least one logged activity (non-draft). */
export function computeTrainingStreak(
  activityDates: string[],
  referenceDate = new Date()
): number {
  if (activityDates.length === 0) return 0;

  const daySet = new Set(
    activityDates.map((iso) => iso.slice(0, 10))
  );

  let streak = 0;
  const cursor = new Date(referenceDate);
  cursor.setHours(0, 0, 0, 0);

  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!daySet.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
