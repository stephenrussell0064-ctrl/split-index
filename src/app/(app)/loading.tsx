import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown instantly while a route in this group server-fetches its data —
 * without this, Next.js shows nothing at all (the previous page just sits
 * frozen) until the whole page's data is ready, which reads as "tacky."
 * The shell (sidebar/top bar) stays mounted throughout since this only
 * replaces the page content slot, not the whole layout.
 */
export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass rounded-2xl p-5 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="glass rounded-2xl p-6 space-y-4">
          <SkeletonText lines={3} />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="glass rounded-2xl p-6 space-y-4">
          <SkeletonText lines={4} />
        </div>
      </div>
    </div>
  );
}
