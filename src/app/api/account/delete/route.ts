import { NextResponse } from "next/server";
import { databaseError, serverError } from "@/lib/api/errors";
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
      /*
       * The table name went to the client here, alongside the Postgres
       * message — a request that fails halfway through enumerated part of the
       * schema to whoever made it. Which table failed is exactly what WE need
       * and precisely what the caller does not, so it moves to the log.
       */
      return serverError({
        operation: "DELETE /api/account/delete",
        cause: error,
        context: { table },
      });
    }
  }

  // Friends where this user is the friend_id (reverse direction).
  await admin.from("friends").delete().eq("friend_id", user.id);

  // Duels have no user_id column — either party can be challenger or opponent.
  await admin.from("duels").delete().eq("challenger_id", user.id);
  await admin.from("duels").delete().eq("opponent_id", user.id);

  // Squad membership rows first (would cascade anyway via squads FK, but
  // explicit here so a member leaving doesn't wait on squad deletion order);
  // squads this user created cascade-delete their own squad_members rows too.
  await admin.from("squad_members").delete().eq("user_id", user.id);
  await admin.from("squads").delete().eq("created_by", user.id);

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);
  if (authError) {
    return databaseError(authError, { operation: "DELETE /api/account/delete" });
  }

  return NextResponse.json({ success: true });
}
