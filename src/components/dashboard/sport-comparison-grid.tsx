import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChartEmptyState } from "@/components/analytics/charts";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { SPORTS } from "@/lib/constants/sports";
import { computeSportComparison } from "@/lib/utils/sport-comparison";

function sportLabel(sport: string): string {
  return SPORTS.find((s) => s.id === sport)?.name ?? sport.replace("_", " ");
}

interface SportComparisonGridProps {
  /** Most-recent-first sport_index history per sport (including gym). */
  scoresBySport: Record<string, number[]>;
  className?: string;
}

/**
 * Replaces the Sport Balance Radar (user feedback: it "is currently not
 * showing any data"). Root cause: the radar required 3+ distinct CARDIO
 * disciplines (gym excluded entirely) and its "Strength" series was always
 * hardcoded to 0 regardless of real data — for a typical hybrid athlete
 * training 1-2 cardio sports plus gym, it was blank essentially by design.
 * This reuses the same "latest session vs your own recent average"
 * comparison already built and proven on the activity detail page
 * (computeSportComparison/SportComparisonPanel), one tile per sport
 * actually trained — reliably populated from a single logged session,
 * and framed as competing against your own history rather than an
 * abstract, rarely-complete shape.
 */
export function SportComparisonGrid({ scoresBySport, className }: SportComparisonGridProps) {
  const entries = Object.entries(scoresBySport).filter(([, scores]) => scores.length > 0);

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-2">
        <CardTitle>Sport Comparison</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <ChartEmptyState message="Log a session to see how you compare to your own history" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {entries.map(([sport, scores]) => {
              const [latest, ...rest] = scores;
              const comparison = computeSportComparison(latest, rest);
              const delta = comparison.deltaVsAverage;
              const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
              const deltaColor = delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted";
              const isGym = sport === "gym";
              return (
                <div key={sport} className="glass rounded-xl p-3">
                  <p className="truncate text-[10px] uppercase tracking-wider text-muted">
                    {sportLabel(sport)}
                  </p>
                  <p
                    className={cn(
                      "index-display mt-0.5 text-lg font-semibold tabular-nums",
                      isGym ? "text-strength-accent" : "text-cardio-accent"
                    )}
                  >
                    {formatIndex(latest)}
                  </p>
                  <p className={cn("flex items-center gap-0.5 text-[10px] font-medium tabular-nums", deltaColor)}>
                    <Icon className="h-3 w-3 shrink-0" />
                    {formatTrend(delta)} vs your avg
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
