import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this, opening the GPS screen briefly painted the Engine tab's own
 * skeleton — "Endurance HQ", two zone buttons — because the nearest loading
 * boundary was /cardio's. For a second the athlete was on the wrong screen,
 * and then the real one replaced it. This one is the shape of the start
 * screen: the header, the hero card and the settings list.
 */
export default function GpsRunLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted">The Engine</p>
        <h1 className="text-xl font-semibold tracking-tight md:text-3xl">GPS Tracking</h1>
        <p className="text-sm text-muted">Lock your phone. Tracking keeps going.</p>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-72 w-full rounded-[1.75rem]" />
        <Skeleton className="h-56 w-full rounded-[1.75rem]" />
        <Skeleton className="h-14 w-full rounded-[1.25rem] bg-accent/15 border-accent/20" />
      </div>
    </div>
  );
}
