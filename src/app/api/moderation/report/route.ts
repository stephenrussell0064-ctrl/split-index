import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { REFUSAL_MESSAGES, REPORT_REASONS, validateReport } from "@/lib/moderation";

/**
 * Report a comment or a profile — guideline 1.2's second requirement.
 *
 * Apple asks for "a mechanism to report offensive content **and timely
 * responses to concerns**". The mechanism is this route; the response is a
 * person reading `content_reports` where `status = 'open'`, which migration 062
 * indexes for exactly that. Shipping the button without anyone reading the
 * queue satisfies the letter and none of the point.
 *
 * A duplicate report is answered as success rather than refused. The unique
 * index in 062 keeps one row per person per thing so the count stays a signal —
 * but a second tap should reassure the reporter, not tell them off.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  const decision = validateReport({
    reporterId: user.id,
    subjectType: body.subjectType === "profile" ? "profile" : "comment",
    subjectId: body.subjectId ? String(body.subjectId) : null,
    subjectUserId: String(body.subjectUserId ?? ""),
    reason: String(body.reason ?? ""),
    detail: body.detail ? String(body.detail) : null,
  });

  if (!decision.ok) {
    return NextResponse.json({ error: REFUSAL_MESSAGES[decision.reason] }, { status: 400 });
  }

  const r = decision.value;
  const { error } = await supabase.from("content_reports").insert({
    reporter_id: r.reporterId,
    subject_type: r.subjectType,
    subject_id: r.subjectId,
    subject_user_id: r.subjectUserId,
    reason: r.reason,
    detail: r.detail,
  });

  // 23505 is the unique index doing its job: they have already reported this.
  // From the reporter's side nothing is wrong, and saying so would only make
  // them wonder whether the first one counted.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Could not send that report." }, { status: 500 });
  }

  return NextResponse.json({
    reported: true,
    message: "Thanks — we'll look at this. You can also block this account so you stop seeing them.",
  });
}

/** The reasons, so the UI never drifts from what the database will accept. */
export async function GET() {
  return NextResponse.json({ reasons: REPORT_REASONS });
}
