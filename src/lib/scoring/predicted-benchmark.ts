import type { SupabaseClient } from "@supabase/supabase-js";
import type { BenchmarkSport } from "./cardio-benchmarks";

export interface StoredPredictedBenchmark {
  benchmarkSeconds: number;
  sampleCount: number;
  riegelK: number | null;
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
    .select("benchmark_seconds, sample_count, riegel_k")
    .eq("user_id", userId)
    .eq("sport", benchmarkSport)
    .maybeSingle();

  if (!data) return null;

  return {
    benchmarkSeconds: data.benchmark_seconds,
    sampleCount: data.sample_count,
    riegelK: data.riegel_k,
  };
}
