import { parseQuery } from "@/lib/validation/boundary";
import { idQuerySchema } from "@/lib/validation/schemas/query";
import { parseBody } from "@/lib/validation/boundary";
import { sessionTemplateSchema } from "@/lib/validation/schemas/routes";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import type { SportType } from "@/types";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") as SportType | undefined;

  let query = supabase
    .from("session_templates")
    .select("id, name, sport, template_data, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (sport) {
    query = query.eq("sport", sport);
  }

  const { data, error } = await query.limit(20);

  if (error) {
    return databaseError(error, { operation: "GET /api/session-templates" });
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // N1. Another assertion: `sport` was typed as SportType and checked only for
  // truthiness, so any non-empty string reached the insert.
  const parsed = await parseBody(request, sessionTemplateSchema);
  if (parsed.response) return parsed.response;
  const { name, sport, template_data } = parsed.data;

  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      user_id: user.id,
      name: name.trim(),
      sport,
      template_data,
    })
    .select()
    .single();

  if (error) {
    return databaseError(error, { operation: "POST /api/session-templates" });
  }

  return NextResponse.json({ template: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // N1. A malformed uuid in a WHERE clause is a Postgres cast error rather
  // than a miss, so this rejects instead of falling back.
  const q = parseQuery(request, idQuerySchema);
  if (q.response) return q.response;
  const id = q.data.id;

  const { error } = await supabase
    .from("session_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/session-templates" });
  }

  return NextResponse.json({ ok: true });
}
