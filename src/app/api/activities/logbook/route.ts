import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchLogbookPage,
  parseSort,
  parseZone,
  LOGBOOK_PAGE_SIZE,
} from "@/lib/activities/logbook-query";
import { SPORTS } from "@/lib/constants/sports";

/**
 * Paged logbook reads for the client feed.
 *
 * A new route rather than a GET on /api/activities (which is the activity
 * *write* endpoint and carries the whole scoring pipeline with it) — this is
 * a plain read and has no business sharing a module with that.
 *
 * Every query runs as the requesting user through the SSR Supabase client,
 * so RLS remains the actual access boundary; the explicit user_id filter
 * inside fetchLogbookPage is belt-and-braces, not the security model.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sportParam = searchParams.get("sport");
  // Only ever pass a sport the app actually knows about — this string reaches
  // a query filter, so it gets matched against the catalog rather than trusted.
  const sport = SPORTS.some((s) => s.id === sportParam) ? sportParam : null;

  const page = await fetchLogbookPage(supabase, user.id, {
    zone: parseZone(searchParams.get("zone")),
    sport,
    sort: parseSort(searchParams.get("sort")),
    offset: Math.max(0, Number(searchParams.get("offset")) || 0),
    limit: Number(searchParams.get("limit")) || LOGBOOK_PAGE_SIZE,
  });

  return NextResponse.json(page);
}
