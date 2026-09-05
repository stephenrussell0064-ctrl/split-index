import type { SupabaseClient } from "@supabase/supabase-js";
import type { BenchmarkSport } from "./cardio-benchmarks";

export interface StoredPredictedBenchmark {
  benchmarkSeconds: number;
  sampleCount: number;
  riegelK: number | null;
  /**
   * When the prediction was last written — the "days since a session" clock.
   *
   * Optional because only the decay EXPLANATION needs it: the loader always
   * supplies it, but the several callers that just want the number (today's
   * plan, the hybrid report) should not have to carry timestamps through
   * their fixtures to prove they don't use them.
   */
  updatedAt?: string | null;
  /** When a quality effort last refreshed it. Decay has separate grace periods for the two. */
  lastQualityAt?: string | null;
}

/**
 * The user's current best-known Tier 2 profile-level prediction for one
 * benchmark sport (run/walk/row/swim/cycle/ski). Previously this exact
 * `.eq("sport", benchmarkSport).maybeSingle()` query was duplicated inline
 * in three activity routes — extracted here so Part 3's "Today" card (and
 * anything else that needs "the user's current predicted time") reads the
 * same real number those routes already maintain, rather than
 * recalculating it.
 */
export async function getPredictedBenchmark(
  supabase: SupabaseClient,
  userId: string,
  benchmarkSport: BenchmarkSport
): Promise<StoredPredictedBenchmark | null> {
  const { data } = await supabase
    .from("predicted_benchmarks")
    .select("benchmark_seconds, sample_count, riegel_k, updated_at, last_quality_at")
    .eq("user_id", userId)
    .eq("sport", benchmarkSport)
    .maybeSingle();

  if (!data) return null;

  return {
    benchmarkSeconds: data.benchmark_seconds,
    sampleCount: data.sample_count,
    riegelK: data.riegel_k,
    // Needed to explain the number, not to compute it. The stored value is
    // undecayed — decay is only folded in when the next session is logged and
    // the decayed prior is blended back — so a reader who has been away sees a
    // figure that will drop the moment they train, with nothing saying why.
    // These two let explainStoredPrediction say it out loud.
    updatedAt: data.updated_at,
    lastQualityAt: data.last_quality_at,
  };
}
