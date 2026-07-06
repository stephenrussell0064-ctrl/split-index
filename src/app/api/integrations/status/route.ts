import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connections } = await supabase
    .from("integration_connections")
    .select(
      "id, provider, auto_sync, last_sync_at, sync_status, sync_error, connected_at, metadata"
    )
    .eq("user_id", user.id);

  const { data: recentJobs } = await supabase
    .from("import_jobs")
    .select(
      "id, source, provider, status, step, progress_pct, total, processed, imported, skipped, failed, errors, created_at, completed_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    connections: (connections ?? []).map((c) => ({
      ...c,
      connected: true,
    })),
    recentJobs: recentJobs ?? [],
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { provider, auto_sync } = body as {
    provider?: string;
    auto_sync?: boolean;
  };

  if (!provider || typeof auto_sync !== "boolean") {
    return NextResponse.json(
      { error: "provider and auto_sync are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("integration_connections")
    .update({ auto_sync })
    .eq("user_id", user.id)
    .eq("provider", provider)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connection: data });
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
  const provider = searchParams.get("provider");

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("integration_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ disconnected: true });
}
