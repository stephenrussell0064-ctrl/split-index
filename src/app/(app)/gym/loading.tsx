import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Lab, before its data arrives.
 *
 * The route group's generic skeleton covered this tab, and it was the wrong
 * shape: neutral grey boxes in a four-up stat grid on a tab that is green,
 * one column, and opens with a title. Tapping "Strength" showed the old page
 * for a beat, then grey, then the real thing — three layouts for one tap.
 *
 * This one draws the destination: the zone toggle, the real title and the
 * real button (both static, so they cost nothing to show early), and a
 * column of placeholders the same height as the strip, the plan card and
 * the logbook that replace them. Because it is a `loading.tsx` in this
 * segment, Next prefetches it with the tab link and paints it on the tap
 * itself, before a single query has run.
 */
export default function GymLoading() {
  return (
    <TrainZoneSwipe mode="gym">
      <div className="bg-gym-zone rounded-2xl overflow-hidden border border-gym-border/40 min-h-[80dvh]">
        <div className="p-4 sm:p-10">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="micro-label text-gym-accent mb-1.5">The Lab</p>
              <h1 className="headline-tight text-3xl font-bold text-gym-text sm:text-5xl">
                Strength HQ
              </h1>
            </div>
            <Skeleton className="h-12 w-36 rounded-2xl bg-gym-accent/20 border-gym-accent/20" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-4">
              <div className="glass-gym rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24 bg-gym-border/30" />
                    <Skeleton className="h-10 w-28 bg-gym-border/30" />
                  </div>
                  <div className="flex gap-5">
                    <Skeleton className="h-10 w-14 bg-gym-border/30" />
                    <Skeleton className="h-10 w-14 bg-gym-border/30" />
                  </div>
                </div>
                <Skeleton className="mt-3 h-14 w-full bg-gym-border/20" />
              </div>

              <Skeleton className="h-24 w-full rounded-2xl bg-gym-accent/10 border-gym-accent/20" />

              <div className="rounded-2xl border border-gym-border/40 p-4">
                <Skeleton className="mb-3 h-3 w-32 bg-gym-border/30" />
                <div className="space-y-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-16 w-full bg-gym-border/20" />
                  ))}
                </div>
              </div>
            </div>

            <aside className="hidden min-w-0 xl:block">
              <Skeleton className="h-64 w-full rounded-2xl bg-gym-border/20" />
            </aside>
          </div>
        </div>
      </div>
    </TrainZoneSwipe>
  );
}
