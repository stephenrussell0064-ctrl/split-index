import { Skeleton } from "@/components/ui/skeleton";

/**
 * The logbook itself, and the screen a delete returns to.
 *
 * Same reasoning as the detail route's boundary: this page counts and fetches
 * before it renders, and without something at this segment the previous screen
 * simply freezes. It matters twice here — once when the logbook is opened, and
 * again when `DeleteActivityModal` pushes back to it after a delete, which is
 * the other half of what was reported as laggy.
 */
export default function LogbookLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
