import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Engine, before its data arrives — the same reasoning as gym/loading.tsx.
 * The light zone, the real title, and placeholders the shape of the strip,
 * the plan card and the logbook, painted on the tap rather than after the
 * queries.
 */
export default function CardioLoading() {
  return (
    <TrainZoneSwipe mode="cardio">
      <div className="bg-cardio-zone rounded-2xl overflow-hidden border border-cardio-border/40 min-h-[80dvh]">
        <div className="p-4 sm:p-10">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="micro-label text-cardio-accent mb-1.5">The Engine</p>
              <h1 className="headline-tight text-3xl font-bold text-cardio-text sm:text-4xl">
                Endurance HQ
              </h1>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-12 w-32 rounded-2xl bg-cardio-border/20 border-cardio-border/30" />
              <Skeleton className="h-12 w-40 rounded-2xl bg-cardio-accent/20 border-cardio-accent/20" />
            </div>
          </div>

          <div className="glass-cardio mb-4 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-28 bg-cardio-border/30 border-cardio-border/20" />
                <Skeleton className="h-10 w-24 bg-cardio-border/30 border-cardio-border/20" />
              </div>
              <div className="w-40 space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-5 w-full bg-cardio-border/20 border-cardio-border/20" />
                ))}
              </div>
            </div>
          </div>

          <Skeleton className="mb-4 h-24 w-full rounded-2xl bg-cardio-accent/10 border-cardio-accent/20" />

          <div className="rounded-2xl border border-cardio-border/40 p-4">
            <Skeleton className="mb-3 h-3 w-32 bg-cardio-border/30 border-cardio-border/20" />
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full bg-cardio-border/20 border-cardio-border/20" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </TrainZoneSwipe>
  );
}
