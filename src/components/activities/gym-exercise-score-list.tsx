import { formatIndex, formatWeight } from "@/lib/utils/format";
import { setsForExercise } from "@/lib/activities/gym-sets";
import type { GymExercise } from "@/types";
import type { GatedStrengthInsight } from "@/lib/scoring/activity-insights";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";

function formatSetSummary(ex: GymExercise): string {
  const sets = setsForExercise(ex);
  if (sets.length === 0) {
    return `${ex.sets}×${ex.reps} @ ${formatWeight(ex.weight_kg)}`;
  }
  if (sets.length === 1) {
    return `1×${sets[0].reps} @ ${formatWeight(sets[0].weight_kg)}`;
  }
  const best = sets.reduce((top, s) =>
    s.weight_kg * (1 + s.reps / 30) > top.weight_kg * (1 + top.reps / 30) ? s : top
  );
  return `${sets.length} sets · best ${formatWeight(best.weight_kg)}×${best.reps}`;
}

function insightForExercise(
  exerciseName: string,
  index: number,
  exerciseCount: number,
  insights: GatedStrengthInsight[] | null
): GatedStrengthInsight | undefined {
  if (!insights?.length) return undefined;
  const byName = insights.find(
    (row) => row.name.toLowerCase() === exerciseName.toLowerCase()
  );
  if (byName) return byName;
  // Persisted breakdown uses canonical lift keys — fall back to log order.
  if (insights.length === exerciseCount && index < insights.length) {
    return insights[index];
  }
  return undefined;
}

export function GymExerciseScoreList({
  exercises,
  insights,
  bodyweightKg,
}: {
  exercises: GymExercise[];
  insights: GatedStrengthInsight[] | null;
  bodyweightKg: number | null;
}) {
  if (!exercises.length) return null;

  return (
    <ul className="space-y-3">
      {exercises.map((ex, index) => {
        const insight = insightForExercise(
          ex.exercise_name,
          index,
          exercises.length,
          insights
        );
        const result = insight?.result as ScoreStrengthResult | undefined;

        return (
          <li
            key={ex.id}
            className="rounded-xl border border-gym-border/25 bg-gym-bg/30 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gym-text">{ex.exercise_name}</p>
                <p className="mt-1 text-xs text-gym-muted tabular-nums">
                  {formatSetSummary(ex)}
                  {ex.estimated_1rm_kg
                    ? ` · est. 1RM ${formatWeight(ex.estimated_1rm_kg)}`
                    : ""}
                </p>
                {result && (
                  <p className="mt-1 text-xs text-gym-muted tabular-nums">
                    {result.tier}
                    {result.bodyweightRatio
                      ? ` · ${result.bodyweightRatio}× bodyweight`
                      : ""}
                  </p>
                )}
              </div>
              {result && (
                <div className="shrink-0 text-right">
                  <p className="font-display text-2xl font-bold tabular-nums text-gym-accent">
                    {formatIndex(result.score)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-gym-muted">
                    lift index
                  </p>
                </div>
              )}
              {!result && (
                <p className="text-xs text-gym-muted shrink-0">Score unavailable</p>
              )}
            </div>
          </li>
        );
      })}
      {bodyweightKg && (
        <p className="text-xs text-gym-muted pt-1">Bodyweight: {formatWeight(bodyweightKg)}</p>
      )}
    </ul>
  );
}
