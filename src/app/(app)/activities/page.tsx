import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LogbookFeed } from "@/components/activities/logbook-feed";
import {
  fetchLogbookPage,
  fetchLogbookSportCounts,
  parseZone,
  LOGBOOK_PAGE_SIZE,
} from "@/lib/activities/logbook-query";

/**
 * The full logbook — one reverse-chronological feed across both zones.
 *
 * The first page is rendered on the server so the list is on screen with the
 * rest of the page (no spinner-then-content flash on a cold mobile start);
 * everything after it pages in through /api/activities/logbook. `?zone=` lets
 * The Lab and The Engine deep-link into their own slice of the same feed
 * instead of each maintaining a private, differently-shaped copy of it.
 */
export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ zone?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const initialZone = parseZone((await searchParams).zone);

  const [initialPage, sportCounts] = await Promise.all([
    fetchLogbookPage(supabase, user.id, { zone: initialZone, limit: LOGBOOK_PAGE_SIZE }),
    fetchLogbookSportCounts(supabase, user.id),
  ]);

  const hasAnyActivity = Object.keys(sportCounts).length > 0;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="micro-label text-muted mb-2">Logbook</p>
          <h1 className="page-title">Activities</h1>
        </div>
        <Link href="/activities/new">
          <Button size="sm">
            <PlusCircle className="h-4 w-4" />
            Log new
          </Button>
        </Link>
      </div>

      {!hasAnyActivity ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] py-16 text-center">
          <p className="font-medium">No activities yet</p>
          <Link href="/activities/new" className="mt-4 inline-block text-sm text-accent">
            Log workout →
          </Link>
        </div>
      ) : (
        <LogbookFeed
          initialPage={initialPage}
          surface="neutral"
          mode="full"
          zone="all"
          initialZone={initialZone}
          sportCounts={sportCounts}
          pageSize={LOGBOOK_PAGE_SIZE}
        />
      )}
    </div>
  );
}
