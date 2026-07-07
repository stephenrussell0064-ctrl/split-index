import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const USER_TABLES = [
  "leaderboard_entries",
  "strength_scores",
  "workout_scores",
  "split_index_history",
  "ai_feedback",
  "personal_records",
  "goals",
  "recovery_snapshots",
  "body_metrics",
  "workout_drafts",
  "session_templates",
  "notifications",
  "user_achievements",
  "challenge_participants",
  "friends",
  "import_jobs",
  "integration_connections",
  "activities",
  "profiles",
] as const;

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  for (const table of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", user.id);
    if (error && error.code !== "42P01") {
      return NextResponse.json(
        { error: `Failed to purge ${table}: ${error.message}` },
        { status: 500 }
      );
    }
  }

  // Friends where this user is the friend_id (reverse direction).
  await admin.from("friends").delete().eq("friend_id", user.id);

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
