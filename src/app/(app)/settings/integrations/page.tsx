"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Link2, Unlink, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PremiumTease } from "@/components/premium/premium-tease";
import { canAccess } from "@/lib/premium/features";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

interface ConnectionRow {
  id: string;
  provider: string;
  auto_sync: boolean;
  last_sync_at: string | null;
  sync_status: "idle" | "syncing" | "error" | "success";
  sync_error: string | null;
  connected_at: string;
  metadata: { demo?: boolean; configured?: boolean };
}

interface ImportJobRow {
  id: string;
  provider: string | null;
  status: string;
  imported: number;
  skipped: number;
  failed: number;
  created_at: string;
}

/** Strava is the only real, wired-up provider today — the rest are backend-ready (schema, OAuth routes, sync pipeline) but need real API credentials/approval before they're worth surfacing. */
const AVAILABLE_PROVIDERS = [{ id: "strava", name: "Strava" }] as const;
const COMING_SOON_PROVIDERS = [
  { id: "garmin", name: "Garmin" },
  { id: "polar", name: "Polar" },
  { id: "coros", name: "Coros" },
  { id: "fitbit", name: "Fitbit" },
  { id: "apple_health", name: "Apple Health" },
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  premium_required: "Connecting a device requires Premium.",
  unknown_provider: "That provider isn't supported yet.",
  missing_code: "The connection was cancelled or didn't complete.",
  invalid_state: "The connection request expired — please try again.",
  state_mismatch: "The connection request expired — please try again.",
};

export default function IntegrationsSettingsPage() {
  const searchParams = useSearchParams();
  const [premium, setPremium] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [recentJobs, setRecentJobs] = useState<ImportJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/integrations/status");
    if (!res.ok) return;
    const data = await res.json();
    setConnections(data.connections ?? []);
    setRecentJobs(data.recentJobs ?? []);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("subscription_tier, subscription_status")
        .eq("user_id", user.id)
        .single();
      if (data) {
        setPremium(
          canAccess(
            "oauth_sync",
            data.subscription_tier as SubscriptionTier,
            data.subscription_status as SubscriptionStatus | null
          )
        );
      }
      await loadStatus();
      setLoading(false);
    });
  }, [loadStatus]);

  const connectError = searchParams.get("error");
  const justConnected = searchParams.get("connected");

  const connectionFor = (providerId: string) => connections.find((c) => c.provider === providerId);

  async function handleSync(providerId: string) {
    setSyncingProvider(providerId);
    setActionError(null);
    try {
      const res = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Sync failed");
      }
      await loadStatus();
    } catch {
      setActionError("Sync failed — please try again.");
    } finally {
      setSyncingProvider(null);
    }
  }

  async function handleDisconnect(providerId: string) {
    const confirmed = window.confirm(`Disconnect ${providerId}? Already-imported activities stay, but auto-sync stops.`);
    if (!confirmed) return;
    await fetch(`/api/integrations/status?provider=${providerId}`, { method: "DELETE" });
    await loadStatus();
  }

  async function handleAutoSyncToggle(providerId: string, autoSync: boolean) {
    await fetch("/api/integrations/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerId, auto_sync: autoSync }),
    });
    await loadStatus();
  }

  if (loading) {
    return <div className="max-w-2xl space-y-6" />;
  }

  const body = (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connected Devices</h1>
        <p className="mt-1 text-sm text-muted">
          Sync activities automatically instead of logging them by hand.
        </p>
      </div>

      {connectError && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {ERROR_MESSAGES[connectError] ?? "Something went wrong connecting that provider."}
        </div>
      )}
      {justConnected && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Connected — your recent activities will import shortly.
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

      {AVAILABLE_PROVIDERS.map((p) => {
        const conn = connectionFor(p.id);
        return (
          <Card key={p.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-accent" />
                  <CardTitle>{p.name}</CardTitle>
                </div>
                {conn && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      conn.sync_status === "error"
                        ? "bg-danger/15 text-danger"
                        : conn.sync_status === "syncing"
                          ? "bg-accent/15 text-accent"
                          : "bg-success/15 text-success"
                    }`}
                  >
                    {conn.sync_status === "error" ? "Sync error" : conn.sync_status === "syncing" ? "Syncing…" : "Connected"}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {conn ? (
                <>
                  <p className="text-sm text-muted">
                    {conn.last_sync_at
                      ? `Last synced ${formatDistanceToNow(new Date(conn.last_sync_at), { addSuffix: true })}`
                      : "Not synced yet"}
                    {conn.metadata?.demo && " · demo mode (no real API credentials configured yet)"}
                  </p>
                  {conn.sync_error && <p className="text-xs text-danger">{conn.sync_error}</p>}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={conn.auto_sync}
                      onChange={(e) => handleAutoSyncToggle(p.id, e.target.checked)}
                      className="h-4 w-4 rounded border-white/20"
                    />
                    Auto-sync new activities
                  </label>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      loading={syncingProvider === p.id}
                      onClick={() => handleSync(p.id)}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Sync now
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-danger/40 text-danger hover:bg-danger/10"
                      onClick={() => handleDisconnect(p.id)}
                    >
                      <Unlink className="h-4 w-4" />
                      Disconnect
                    </Button>
                  </div>
                </>
              ) : (
                <Link href={`/api/integrations/connect/${p.id}`}>
                  <Button className="w-full">Connect {p.name}</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted">
            {COMING_SOON_PROVIDERS.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                {p.name}
                <span className="text-xs uppercase tracking-wider">Not yet available</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            No device that exports a file? You can still drag in a GPX, TCX, FIT, or CSV export
            when logging an activity.
          </p>
        </CardContent>
      </Card>

      {recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent imports</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {recentJobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between text-muted">
                  <span>
                    {job.provider ?? "file"} · {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                  </span>
                  <span className="tabular-nums">
                    {job.imported} imported
                    {job.skipped > 0 ? ` · ${job.skipped} skipped` : ""}
                    {job.failed > 0 ? ` · ${job.failed} failed` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );

  if (premium === false) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Connected Devices</h1>
          <p className="mt-1 text-sm text-muted">
            Sync activities automatically instead of logging them by hand.
          </p>
        </div>
        <PremiumTease
          title="Connect Strava"
          subtitle="Premium unlocks automatic activity sync — log once, everywhere."
        >
          {body}
        </PremiumTease>
      </div>
    );
  }

  return body;
}
