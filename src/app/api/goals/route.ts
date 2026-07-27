import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MIN_TARGET = 350;
const MAX_TARGET = 999;

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

  const deadline = new Date();
  deadline.setMonth(deadline.getMonth() + 3);

  const { data: goal, error } = await supabase
    .from("goals")
    .insert({
      user_id: user.id,
      title: `Reach Split Index ${Math.round(targetSplitIndex)}`,
      target_split_index: targetSplitIndex,
      deadline: deadline.toISOString().slice(0, 10),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ goal });
}
