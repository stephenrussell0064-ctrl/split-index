import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ARTICLE9_CONSENT_KEY,
  ARTICLE9_CONSENT_TEXT,
  ARTICLE9_CONSENT_VERSION,
  getArticle9Consent,
  recordArticle9Event,
} from "@/lib/consent/article9";

/**
 * Article 9 explicit consent — grant, withdraw, and read the current state.
 *
 * GET returns the wording as well as the state, deliberately: the screen that
 * asks must render the same text that gets recorded, and the only way to
 * guarantee that is for both to come from one place. A consent screen with its
 * own copy of the words is a screen that will drift from the evidence.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = await getArticle9Consent(supabase, user.id);

  return NextResponse.json({
    ...state,
    consentKey: ARTICLE9_CONSENT_KEY,
    currentVersion: ARTICLE9_CONSENT_VERSION,
    wording: ARTICLE9_CONSENT_TEXT,
    /**
     * True when they agreed to older wording than what ships now. The UI can
     * use this to re-ask rather than assume; a material change to what the
     * data is used for needs fresh consent, not a silent carry-over.
     */
    staleVersion: state.granted && state.version !== ARTICLE9_CONSENT_VERSION,
  });
}

/** Grant. Requires the client to have actually shown the current wording. */
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
   * The client must echo back the version it displayed, and it must match what
   * this build would record. Without that check a stale tab could produce a
   * consent record claiming the athlete saw wording that was replaced weeks
   * ago — the evidence would say one thing and the screen said another, which
   * is worse than having no record at all.
   */
  if (body?.acknowledgedVersion !== ARTICLE9_CONSENT_VERSION) {
    return NextResponse.json(
      {
        error:
          "This consent wording has been updated. Please reload and read the current version before agreeing.",
        currentVersion: ARTICLE9_CONSENT_VERSION,
      },
      { status: 409 }
    );
  }

  const { error } = await recordArticle9Event(supabase, user.id, "granted");
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ granted: true, version: ARTICLE9_CONSENT_VERSION });
}

/**
 * Withdraw, and delete.
 *
 * Order matters and is deliberate: the withdrawal event is recorded FIRST,
 * then the data is deleted. If the delete fails, the record still says they
 * withdrew and the gate is already closed against every read path — the
 * failure leaves data that should be gone, which is recoverable by retrying.
 * The other order risks deleting the data and losing the evidence that they
 * asked, which is not recoverable.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error: eventError } = await recordArticle9Event(supabase, user.id, "withdrawn");
  if (eventError) return NextResponse.json({ error: eventError }, { status: 500 });

  // Acts on auth.uid() and takes no argument, so it cannot be aimed at anyone
  // else's row — see migration 057.
  const { error: purgeError } = await supabase.rpc("withdraw_article9_health_data");

  if (purgeError) {
    return NextResponse.json(
      {
        withdrawn: true,
        purged: false,
        // Generic on purpose — the detail goes to the server log, not to the
        // client. What the athlete needs to know is the true part: the consent
        // is withdrawn and nothing more will be processed.
        error:
          "Your consent is withdrawn and the Hybrid Plan is switched off. Deleting the stored answers did not finish — please try again, or contact us and we will remove them.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ withdrawn: true, purged: true });
}
