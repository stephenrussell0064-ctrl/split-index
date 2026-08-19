/**
 * The "could these two be one session?" test, with nothing else attached.
 *
 * Split out from merge.ts so the logbook can run it on every visible row
 * without pulling the GPS-track module (and its route maths) into the client
 * bundle. merge.ts re-exports the threshold, so there is still one number.
 *
 * This is deliberately the cheap half of the check — sport and proximity only.
 * The server re-runs the full assessment on the ids it is actually given, so a
 * selection this lets through can still be refused with a reason; what it buys
 * is that the athlete is not invited to select two sessions three weeks apart
 * in the first place.
 */

/**
 * How far apart two recordings may be and still plausibly be one interrupted
 * session. See MERGE_MAX_GAP_SECONDS in merge.ts for why two hours.
 */
export const MERGE_MAX_GAP_SECONDS = 2 * 60 * 60;

export interface MergeCandidate {
  id: string;
  sport: string;
  startedAt: string;
  durationSeconds: number | null;
}

function startMs(a: MergeCandidate): number {
  return new Date(a.startedAt).getTime();
}

function endMs(a: MergeCandidate): number {
  return startMs(a) + (a.durationSeconds ?? 0) * 1000;
}

/** Gap in seconds between two sessions, or null if they overlap in time. */
export function gapBetween(a: MergeCandidate, b: MergeCandidate): number | null {
  const [first, second] = startMs(a) <= startMs(b) ? [a, b] : [b, a];
  const gapMs = startMs(second) - endMs(first);
  return gapMs < 0 ? null : Math.round(gapMs / 1000);
}

/**
 * Whether `candidate` could join a selection that already contains
 * `selected` — same sport, no overlap, and within the gap window of at
 * least one already-selected session (so a run split into three pieces can be
 * built up one leg at a time).
 */
export function canJoinSelection(
  candidate: MergeCandidate,
  selected: MergeCandidate[]
): boolean {
  if (selected.length === 0) return true;
  if (selected.some((s) => s.id === candidate.id)) return true;
  if (selected.some((s) => s.sport !== candidate.sport)) return false;
  if (candidate.sport !== selected[0].sport) return false;
  return selected.some((s) => {
    const gap = gapBetween(s, candidate);
    return gap !== null && gap <= MERGE_MAX_GAP_SECONDS;
  });
}
