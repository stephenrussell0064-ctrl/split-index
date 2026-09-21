import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/**
 * Shown the instant a logbook row is tapped.
 *
 * Reported from a device as "clicking an entry is very laggy, and does not
 * work on the first click". Both halves are the same cause. This page is a
 * server component that awaits the user, the activity, the profile and then a
 * Promise.all of workout_scores, gym_exercises and strength_scores before it
 * returns a single byte — and the native shell loads its pages from
 * `server.url` over the network, so that is a real round trip on a real
 * connection.
 *
 * Without a boundary at this segment, Next.js keeps the PREVIOUS page on
 * screen for the whole of it. Nothing moves, nothing greys out, the row does
 * not even look pressed. The only reasonable reading is that the tap missed,
 * so it gets tapped again — and the second tap "works" because by then the
 * first navigation has landed. The click was never lost; there was simply
 * nothing to see.
 *
 * `(app)/loading.tsx` exists and says the same thing in its own comment, but
 * it sits at the group root. A boundary on this segment is the unambiguous
 * one: it wraps exactly the route being navigated into, and it can be shaped
 * like the page that is coming rather than like the dashboard.
 *
 * This does not make the page faster. It makes it honest about being slow,
 * which is the half that was reported.
 */
export default function ActivityDetailLoading() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass rounded-2xl p-5 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-6 space-y-4">
        <SkeletonText lines={2} />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
