import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  request: Request,
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
    .from("squad_members")
    .delete()
    .eq("squad_id", id)
    .eq("user_id", user.id);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/squads/[id]" });
  }

  return NextResponse.json({ ok: true });
}
