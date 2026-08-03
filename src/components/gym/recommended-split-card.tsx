import Link from "next/link";
import { Sparkles, BedDouble } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { GymSplitRecommendation } from "@/lib/scoring/gym-recommendation";

/**
 * Surfaces the balanced-split recommendation (lib/scoring/gym-recommendation.ts)
 * — which muscle groups genuinely need attention based on the athlete's own
 * recent training, with the hard rule that a muscle group trained too
 * recently is never suggested again regardless of how "lacking" it looks.
 */
export function RecommendedSplitCard({
  recommendation,
  className,
}: {
  recommendation: GymSplitRecommendation;
  className?: string;
}) {
  const { recommendedGroups, summary } = recommendation;

  if (recommendedGroups.length === 0) {
    return (
      <Card padding="md" className={cn("border border-white/10", className)}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gym-accent/15">
            <BedDouble className="h-4 w-4 text-gym-accent" />
          </div>
          <div>
            <p className="micro-label mb-1 text-gym-muted">Recommended for next session</p>
            <p className="text-sm text-gym-text/90">{summary}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="md" className={cn("border border-gym-accent/25", className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gym-accent/15">
          <Sparkles className="h-4 w-4 text-gym-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="micro-label mb-1 text-gym-muted">Recommended for next session</p>
          <p className="text-sm text-gym-text/90">{summary}</p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {recommendedGroups.map((group) => (
              <div
                key={group.muscleGroup}
                className="rounded-xl border border-gym-border/40 bg-gym-bg/40 px-4 py-3"
              >
                <p className="text-sm font-semibold text-gym-text">{group.muscleGroup}</p>
                <p className="mt-0.5 text-xs text-gym-muted">{group.exerciseNames.join(", ")}</p>
              </div>
            ))}
          </div>

          <Link href="/gym/log?recommend=1" className="mt-4 inline-block">
            <Button size="sm" className="bg-gym-accent hover:bg-gym-accent/90 text-[#04120a] border-0 font-semibold">
              Start this session
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
