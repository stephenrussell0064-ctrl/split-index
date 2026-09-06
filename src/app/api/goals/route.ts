import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";

const MIN_TARGET = 350;
const MAX_TARGET = 999;
const MAX_TITLE_LENGTH = 120;

function validateTarget(value: unknown): number | null | { error: string } {
  if (value == null || value === "") return null;
  const target = Number(value);
  if (!Number.isFinite(target) || target < MIN_TARGET || target > MAX_TARGET) {
    return { error: `Target must be between ${MIN_TARGET} and ${MAX_TARGET}` };
  }
  return target;
}

function validateDeadline(value: unknown): string | null | { error: string } {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return { error: "Invalid deadline date" };
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const targetSplitIndex = Number(body.targetSplitIndex);

  if (!Number.isFinite(targetSplitIndex) || targetSplitIndex < MIN_TARGET || targetSplitIndex > MAX_TARGET) {
    return NextResponse.json(
      { error: `Target must be between ${MIN_TARGET} and ${MAX_TARGET}` },
      { status: 400 }
    );
  }

  // User feedback (Slice 6): "Allow the user to amend their goals on the
  // dashboard by clicking into the goals section" — the add-a-goal flow now
  // lets a user set their own title/deadline instead of always getting the
  // auto-generated "Reach Split Index N" 3-months-out defaults, while still
  // falling back to those defaults when the caller omits them (keeps the
  // existing empty-state "Set this goal" quick-add working unchanged).
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, MAX_TITLE_LENGTH)
      : `Reach Split Index ${Math.round(targetSplitIndex)}`;

  const deadlineResult = validateDeadline(body.deadline);
  if (deadlineResult && typeof deadlineResult === "object") {
    return NextResponse.json({ error: deadlineResult.error }, { status: 400 });
  }
  let deadline = deadlineResult;
  if (!deadline) {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    deadline = d.toISOString().slice(0, 10);
  }

  const { data: goal, error } = await supabase
    .from("goals")
    .insert({
      user_id: user.id,
      title,
      target_split_index: targetSplitIndex,
      deadline,
    })
    .select()
    .single();

  if (error) {
    return databaseError(error, { operation: "POST /api/goals" });
  }

  return NextResponse.json({ goal });
}

/**
 * Edit an existing goal in place. Every field is optional so the client can
 * send only what changed (e.g. just `{ completed: true }` from a checkbox).
 * RLS's "Users manage own goals" policy (auth.uid() = user_id) is the real
 * ownership check — the `.eq("user_id", user.id)` here is defense in depth,
 * matching the pattern used by every other user-scoped mutation in the app.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const goalId = String(body.id ?? "");
  if (!goalId) {
    return NextResponse.json({ error: "Goal id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Title can't be empty" }, { status: 400 });
    }
    updates.title = title.slice(0, MAX_TITLE_LENGTH);
  }

  if (body.targetSplitIndex !== undefined) {
    const target = validateTarget(body.targetSplitIndex);
    if (target && typeof target === "object") {
      return NextResponse.json({ error: target.error }, { status: 400 });
    }
    updates.target_split_index = target;
  }

  if (body.deadline !== undefined) {
    const deadline = validateDeadline(body.deadline);
    if (deadline && typeof deadline === "object") {
      return NextResponse.json({ error: deadline.error }, { status: 400 });
    }
    updates.deadline = deadline;
  }

  if (body.completed !== undefined) {
    updates.completed = !!body.completed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const { data: goal, error } = await supabase
    .from("goals")
    .update(updates)
    .eq("id", goalId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return databaseError(error, { operation: "PATCH /api/goals" });
  }

  return NextResponse.json({ goal });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const goalId = searchParams.get("id");
  if (!goalId) {
    return NextResponse.json({ error: "Goal id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("goals")
    .delete()
    .eq("id", goalId)
    .eq("user_id", user.id);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/goals" });
  }

  return NextResponse.json({ ok: true });
}
