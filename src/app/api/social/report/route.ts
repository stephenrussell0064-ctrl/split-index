import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Report an athlete or a piece of their content — App Store Guideline 1.2's
 * second requirement ("a mechanism to report offensive content and timely
 * responses to concerns").
 *
 * The report is a row in a queue a human reads. There is deliberately no
 * automatic action attached to it: an endpoint that hid an account on receipt of
 * a report would be a griefing tool, and the guideline asks for review, not
 * automation. What an athlete can do immediately, without waiting for anyone, is
 * block — that is the other half of the pair and it is instant.
 *
 * The stated response time lives in the UI and in the App Review notes, and it
 * has to stay true: 24 hours to a first human look.
 */

/**
 * Fixed reasons rather than free text alone.
 *
 * A reviewer triaging a queue needs to sort it, and "reason" being a category
 * is what makes that possible. `details` carries the reporter's own words on
 * top, capped so the column cannot be used as free storage.
 */
const REPORT_REASONS = [
  "harassment",
  "hate_speech",
  "sexual_content",
  "violence",
  "spam",
  "impersonation",
  "cheating",
  "other",
] as const;

const ReportBody = z.object({
  userId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  /** Which surface this came from: profile, activity, squad, duel, feed_item. */
  subjectType: z.enum(["profile", "activity", "squad", "duel", "feed_item"]).default("profile"),
  subjectId: z.string().uuid().nullish(),
  details: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = ReportBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Tell us what is wrong with this content and we will look at it." },
      { status: 400 }
    );
  }

  const { userId, reason, subjectType, subjectId, details } = parsed.data;
  if (userId === user.id) {
    return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  }

  const { error } = await supabase.from("content_reports").insert({
    reporter_id: user.id,
    reported_user_id: userId,
    subject_type: subjectType,
    subject_id: subjectId ?? null,
    reason,
    details: details || null,
  });

  if (error) {
    // 23505 is the once-per-day dedupe index. Filing the same report twice is
    // not a failure the reporter should have to think about — from where they
    // are standing, the report was already made.
    if (error.code === "23505") {
      return NextResponse.json({ reported: true, alreadyReported: true });
    }
    console.error("[social/report] insert failed for", user.id, error);
    return NextResponse.json({ error: "Could not send this report" }, { status: 500 });
  }

  return NextResponse.json({ reported: true });
}

export { REPORT_REASONS };
