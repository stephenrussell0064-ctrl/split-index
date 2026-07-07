import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/integrations/providers";
import { runImportJob } from "@/lib/integrations/import-pipeline";
import { ensureFreshTokens } from "@/lib/integrations/sync-helpers";
import type { IntegrationProviderId } from "@/lib/integrations/types";

async function syncUserProvider(
  supabase: SupabaseClient,
  userId: string,
  providerId: IntegrationProviderId
) {
  const provider = getProvider(providerId)!;

  const { data: connection, error: connError } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", providerId)
    .single();

  if (connError || !connection) {
    throw new Error("Connection not found");
  }

  await supabase
    .from("integration_connections")
    .update({ sync_status: "syncing", sync_error: null })
    .eq("id", connection.id);

  const since = connection.last_sync_at
    ? new Date(connection.last_sync_at)
    : new Date(Date.now() - 30 * 86400000);

  const tokens = await ensureFreshTokens(
    supabase,
    connection.id,
    connection,
    providerId
  );

  const activities = await provider.fetchActivities(tokens, since);

  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      user_id: userId,
      source: providerId,
      provider: providerId,
      status: "parsing",
      step: "parsing",
      progress_pct: 5,
      total: activities.length,
    })
    .select()
    .single();

  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Failed to create import job");
  }

  const result = await runImportJob(supabase, userId, job.id, activities, providerId);

  await supabase
    .from("integration_connections")
    .update({
      sync_status: result.failed > 0 && result.imported === 0 ? "error" : "success",
      sync_error: result.failed > 0 ? `${result.failed} activities failed` : null,
      last_sync_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return { jobId: job.id, ...result };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isCron = searchParams.get("cron") === "1";
  const cronSecret = searchParams.get("secret") ?? request.headers.get("authorization")?.replace("Bearer ", "");

  if (!isCron) {
    return NextResponse.json({ error: "Use POST for manual sync" }, { status: 405 });
  }

  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections } = await admin
    .from("integration_connections")
    .select("*")
    .eq("auto_sync", true);

  const results: Array<{ userId: string; provider: string; imported?: number; error?: string }> = [];

  for (const conn of connections ?? []) {
    try {
      const result = await syncUserProvider(
        admin,
        conn.user_id,
        conn.provider as IntegrationProviderId
      );
      results.push({
        userId: conn.user_id,
        provider: conn.provider,
        imported: result.imported,
      });
    } catch (err) {
      results.push({
        userId: conn.user_id,
        provider: conn.provider,
        error: err instanceof Error ? err.message : "sync_failed",
      });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const providerId = body.provider as IntegrationProviderId | undefined;

  if (!providerId) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  if (!getProvider(providerId)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  try {
    const result = await syncUserProvider(supabase, user.id, providerId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
