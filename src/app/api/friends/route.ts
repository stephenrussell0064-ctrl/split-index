import { parseBody } from "@/lib/validation/boundary";
import {
  friendActionSchema,
  friendRequestSchema,
} from "@/lib/validation/schemas/routes";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { fetchFriendsData } from "@/lib/social/queries";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await fetchFriendsData(supabase, user.id);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // N1. A leading "@" is still stripped, so pasting "@rachel" works.
  const parsed = await parseBody(request, friendRequestSchema);
  if (parsed.response) return parsed.response;
  const username = parsed.data.username.replace(/^@/, "");

  if (!username) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  const { data: target } = await supabase
    .from("profiles")
    .select("user_id, username")
    .eq("username", username)
    .single();

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.user_id === user.id) {
    return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("friends")
    .select("id, status")
    .or(
      `and(user_id.eq.${user.id},friend_id.eq.${target.user_id}),and(user_id.eq.${target.user_id},friend_id.eq.${user.id})`
    )
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") {
      return NextResponse.json({ error: "Already friends" }, { status: 409 });
    }
    if (existing.status === "pending") {
      return NextResponse.json({ error: "Request already pending" }, { status: 409 });
    }
  }

  const { data: requestRow, error } = await supabase
    .from("friends")
    .insert({
      user_id: user.id,
      friend_id: target.user_id,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return databaseError(error, { operation: "POST /api/friends" });
  }

  return NextResponse.json({ request: requestRow });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // N1. Another assertion — any string was reaching the branch below.
  const parsed = await parseBody(request, friendActionSchema);
  if (parsed.response) return parsed.response;
  const { id, action } = parsed.data;

  const { data: row } = await supabase
    .from("friends")
    .select("*")
    .eq("id", id)
    .single();

  if (!row || row.friend_id !== user.id || row.status !== "pending") {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (action === "decline") {
    await supabase.from("friends").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("friends")
    .update({ status: "accepted" })
    .eq("id", id);

  if (error) {
    return databaseError(error, { operation: "PATCH /api/friends" });
  }

  return NextResponse.json({ ok: true, status: "accepted" });
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
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("friends")
    .select("*")
    .eq("id", id)
    .single();

  if (!row || (row.user_id !== user.id && row.friend_id !== user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await supabase.from("friends").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
