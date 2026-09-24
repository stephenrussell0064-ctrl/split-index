import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { parseParams, uuidParam, z } from "@/lib/validation/boundary";

/**
 * Deleting a logged drink.
 *
 * Mis-taps are the normal case here — the logger is a grid of big buttons and
 * the whole feature is only useful if the athlete trusts that a wrong tap is
 * one tap to undo. A hard delete is right: there is no version of this where
 * a soft-deleted drinking record should linger in a health table.
 *
 * The `.eq("user_id")` is not redundant with RLS. RLS is the boundary that
 * matters, but an ownership filter in the statement means a mis-targeted id
 * deletes nothing rather than relying on the policy alone, and it makes the
 * 404 below honest — "not yours" and "not there" are the same answer, which is
 * the answer that leaks least.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseParams(context.params, z.object({ id: uuidParam }));
  if (parsed.response) return parsed.response;

  const { data, error } = await supabase
    .from("drink_logs")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return databaseError(error, { operation: "DELETE /api/recovery/drinks/[id]" });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ deleted: data.id });
}
