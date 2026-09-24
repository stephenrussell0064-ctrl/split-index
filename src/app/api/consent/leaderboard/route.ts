import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  LEADERBOARD_CONSENT_KEY,
  LEADERBOARD_CONSENT_TEXT,
  LEADERBOARD_CONSENT_VERSION,
  getArticle9Consent,
  recordArticle9Event,
} from "@/lib/consent/article9";

/**
 * Joining and leaving the alcohol-free streak leaderboard.
 *
 * A sibling of /api/consent/article9 rather than a parameter on it. The two
 * consents are deliberately separate — 060 is explicit that Article 9 consent
 * "must stay granular and separately refusable" — and a shared endpoint taking
 * a key in the body is one missing validation away from a request for one
 * consent recording the other.
 *
 * GET returns the wording as well as the state, so the screen that asks and
 * the record that gets stored cannot drift apart.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = await getArticle9Consent(supabase, user.id, LEADERBOARD_CONSENT_KEY);

  return NextResponse.json({
    ...state,
    consentKey: LEADERBOARD_CONSENT_KEY,
    currentVersion: LEADERBOARD_CONSENT_VERSION,
    wording: LEADERBOARD_CONSENT_TEXT,
    staleVersion: state.granted && state.version !== LEADERBOARD_CONSENT_VERSION,
  });
}

/** Join. Requires the client to have actually shown the current wording. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    acknowledgedVersion?: unknown;
  } | null;

  /*
   * The client echoes back the version it displayed, and it must match what
   * this build would record. Without it, a stale tab could produce a consent
   * record claiming the athlete agreed to wording that was replaced weeks ago.
   */
  if (body?.acknowledgedVersion !== LEADERBOARD_CONSENT_VERSION) {
    return NextResponse.json(
      {
        error:
          "This consent wording has been updated. Please reload and read the current version before agreeing.",
        currentVersion: LEADERBOARD_CONSENT_VERSION,
      },
      { status: 409 }
    );
  }

  const { error } = await recordArticle9Event(
    supabase,
    user.id,
    "granted",
    LEADERBOARD_CONSENT_KEY
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ granted: true, version: LEADERBOARD_CONSENT_VERSION });
}

/**
 * Leave.
 *
 * There is nothing to purge, and that is by design rather than an omission.
 * The board is a VIEW over drink_logs filtered by this consent (migration
 * 087) — nothing derived is ever stored — so withdrawing removes the athlete
 * from every future read of it the moment this row lands. The contrast with
 * the Hybrid Plan's withdrawal, which has to delete stored answers, is the
 * whole reason this feature was built as a projection rather than a table.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await recordArticle9Event(
    supabase,
    user.id,
    "withdrawn",
    LEADERBOARD_CONSENT_KEY
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ withdrawn: true });
}
