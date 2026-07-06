export const INDEX_MILESTONES = [500, 600, 700, 800] as const;

export type IndexMilestone = (typeof INDEX_MILESTONES)[number];

export function crossedIndexMilestone(
  previousIndex: number,
  currentIndex: number
): IndexMilestone | null {
  for (const milestone of INDEX_MILESTONES) {
    if (previousIndex < milestone && currentIndex >= milestone) {
      return milestone;
    }
  }
  return null;
}

const STORAGE_KEY = "split-index-milestones";

export function getCelebratedMilestones(): IndexMilestone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IndexMilestone[]) : [];
  } catch {
    return [];
  }
}

export function markMilestoneCelebrated(milestone: IndexMilestone): void {
  if (typeof window === "undefined") return;
  const existing = getCelebratedMilestones();
  if (existing.includes(milestone)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, milestone]));
}
