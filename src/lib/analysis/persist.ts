import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportType } from "@/types";
import { bestEffortDistancesFor, computeBestEfforts } from "./best-efforts";
import { parseActivityStreams, type ActivityStreams } from "./streams";

/**
 * Writes a freshly logged GPS session's streams and best efforts.
 *
 * Secondary on purpose, like strength_scores and predicted_benchmarks in the
 * same handler: the activity is already saved and scored by the time this
 * runs, and losing the analysis costs the athlete a panel on one activity
 * page, not the run. So a failure here is logged loudly and never rolls the
 * session back — and a database that has not yet had migration 078 applied
 * degrades to "no analysis" rather than "no logging".
 *
 * The streams arrive from the client already shaped, but they are re-parsed
 * here (parseActivityStreams) rather than trusted: user-supplied JSON going
 * into a column the detail page computes from. Anything malformed stores
 * nothing.
 */
export interface PersistStreamsInput {
  userId: string;
  activityId: string;
  sport: SportType;
  /** The activity's own started_at, stamped onto each best effort so "previous best" comparisons order by when the run happened. */
  achievedAt: string;
  streams: unknown;
}

export interface PersistStreamsResult {
  stored: boolean;
  bestEffortCount: number;
}

export async function persistActivityStreams(
  supabase: SupabaseClient,
  input: PersistStreamsInput
): Promise<PersistStreamsResult> {
  const streams: ActivityStreams | null = parseActivityStreams(input.streams);
  if (!streams) return { stored: false, bestEffortCount: 0 };

  const { error: streamsError } = await supabase.from("activity_streams").upsert(
    {
      activity_id: input.activityId,
      user_id: input.userId,
      sample_count: streams.time.length,
      streams,
    },
    { onConflict: "activity_id" }
  );
  if (streamsError) {
    console.error("[activities] activity_streams upsert failed:", streamsError.message);
    return { stored: false, bestEffortCount: 0 };
  }

  const efforts = computeBestEfforts(streams, bestEffortDistancesFor(input.sport));
  if (efforts.length === 0) return { stored: true, bestEffortCount: 0 };

  const { error: effortsError } = await supabase.from("activity_best_efforts").upsert(
    efforts.map((e) => ({
      user_id: input.userId,
      activity_id: input.activityId,
      sport: input.sport,
      distance_meters: e.distanceMeters,
      elapsed_seconds: e.elapsedSeconds,
      start_offset_seconds: e.startSeconds,
      achieved_at: input.achievedAt,
    })),
    { onConflict: "activity_id,distance_meters" }
  );
  if (effortsError) {
    console.error("[activities] activity_best_efforts upsert failed:", effortsError.message);
    return { stored: true, bestEffortCount: 0 };
  }

  return { stored: true, bestEffortCount: efforts.length };
}
