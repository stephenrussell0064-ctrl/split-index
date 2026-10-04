import Link from "next/link";
import { Sparkles, BedDouble, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { GymSplitRecommendation } from "@/lib/scoring/gym-recommendation";

/**
 * Surfaces the balanced-split recommendation (lib/scoring/gym-recommendation.ts)
 * — which muscle groups genuinely need attention based on the athlete's own
 * recent training, with the hard rule that a muscle group trained too
 * recently is never suggested again regardless of how "lacking" it looks.
 *
 * ONE ROW OF CHIPS, NOT A GRID OF TILES (4 Oct 2026). The groups used to be a
 * two-column grid of tiles, each with the group name and its exercises on a
 * second line, plus a button underneath — about 170px on a phone for what is
 * a one-line suggestion. The owner wanted the Lab's logbook reachable without
 * so much scrolling and this card to stay where it is, so it got shorter
 * rather than moving: the groups are chips with the exercises in each chip's
 * tooltip, and the start button sits in the header row.
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
      <Card padding="sm" className={cn("border border-white/10 !p-4", className)}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gym-accent/15">
            <BedDouble className="h-4 w-4 text-gym-accent" />
          </div>
          <div className="min-w-0">
            <p className="micro-label mb-0.5 text-gym-muted">Recommended for next session</p>
            <p className="text-sm text-gym-text/90">{summary}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="sm" className={cn("border border-gym-accent/25 !p-4", className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gym-accent/15">
          <Sparkles className="h-4 w-4 text-gym-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="micro-label text-gym-muted">Recommended for next session</p>
            <Link
              href="/gym/log?recommend=1"
              className={cn(
                buttonVariants({ size: "sm" }),
                "h-8 min-h-8 shrink-0 bg-gym-accent px-3 text-xs text-[#04120a] font-semibold border-0 hover:bg-gym-accent/90"
              )}
            >
              Start
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <p className="mt-1 text-sm leading-snug text-gym-text/90">{summary}</p>

          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {recommendedGroups.map((group) => (
              <li
                key={group.muscleGroup}
                title={group.exerciseNames.join(", ")}
                className="rounded-lg border border-gym-border/40 bg-gym-bg/40 px-2.5 py-1 text-xs"
              >
                <span className="font-semibold text-gym-text">{group.muscleGroup}</span>
                <span className="text-gym-muted"> · {group.exerciseNames.slice(0, 2).join(", ")}{group.exerciseNames.length > 2 ? ` +${group.exerciseNames.length - 2}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
