import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("planned_races")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/races/[id]" });
  }

  return NextResponse.json({ ok: true });
}
