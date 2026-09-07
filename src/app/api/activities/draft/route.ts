import { parseBody, parseQuery } from "@/lib/validation/boundary";
import { draftSchema } from "@/lib/validation/schemas/routes";
import { draftQuerySchema } from "@/lib/validation/schemas/query";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /*
    N1. This destructured an unparsed body: no check of any kind, and `sport`
    went straight into an upsert keyed on (user_id, sport). It was also the one
    route storing an unbounded payload — `formData` is written to the database
    as it arrives — so the body size cap parseBody applies matters more here
    than anywhere else in this batch.

    `formData` itself stays a passthrough record. It is the half-finished
    contents of whichever form the athlete is in, the shape differs per sport,
    and only that same form reads it back.
  */
  const parsed = await parseBody(request, draftSchema);
  if (parsed.response) return parsed.response;
  const { sport, formData } = parsed.data;

  const { data, error } = await supabase
    .from("workout_drafts")
    .upsert(
      {
        user_id: user.id,
        sport,
        form_data: formData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,sport" }
    )
    .select()
    .single();

  if (error) {
    return databaseError(error, { operation: "PUT /api/activities/draft" });
  }

  return NextResponse.json({ draft: data });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // N1. `sport` reached `.eq("sport", ...)` unchecked. Optional here: absent
  // still means "every draft".
  const q = parseQuery(request, draftQuerySchema);
  if (q.response) return q.response;
  const sport = q.data.sport;

  let query = supabase.from("workout_drafts").select("*").eq("user_id", user.id);

  if (sport) {
    query = query.eq("sport", sport);
  }

  const { data, error } = await query;

  if (error) {
    return databaseError(error, { operation: "GET /api/activities/draft" });
  }

  return NextResponse.json({ drafts: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Required here, unlike the GET above: "which drafts" and "delete which
  // draft" are different questions about the same parameter.
  const q = parseQuery(request, draftQuerySchema);
  if (q.response) return q.response;
  const sport = q.data.sport;

  if (!sport) {
    return NextResponse.json({ error: "sport is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("workout_drafts")
    .delete()
    .eq("user_id", user.id)
    .eq("sport", sport);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/activities/draft" });
  }

  return NextResponse.json({ ok: true });
}
