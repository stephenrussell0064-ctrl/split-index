"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  Link2,
  RefreshCw,
  Unlink,
  FileSpreadsheet,
  PenLine,
  AlertCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IMPORT_SOURCES } from "@/lib/constants/sports";
import { FileImportDropzone } from "@/components/activities/file-import-dropzone";
import { PremiumTease } from "@/components/premium/premium-tease";
import { isPremiumUser } from "@/lib/retention/trial";
import { createClient } from "@/lib/supabase/client";
import type { ImportJobRow, IntegrationProviderId, ImportStep } from "@/lib/integrations/types";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

interface ConnectionStatus {
  id: string;
  provider: IntegrationProviderId;
  auto_sync: boolean;
  last_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
  connected_at: string;
  metadata: Record<string, unknown>;
  connected: boolean;
}

const OAUTH_PROVIDERS = IMPORT_SOURCES.filter(
  (s) => !["csv", "manual"].includes(s.id)
);

const PROVIDER_ICONS: Record<string, string> = {
  strava: "🟠",
  garmin: "🔵",
  apple_health: "❤️",
  polar: "🔴",
  coros: "⚫",
  fitbit: "🟢",
};

const STEPS: ImportStep[] = ["parsing", "validating", "scoring", "done"];

function stepIndex(step: string): number {
  const idx = STEPS.indexOf(step as ImportStep);
  return idx >= 0 ? idx : 0;
}

function ImportProgressBar({
  step,
  progressPct,
  label,
}: {
  step: string;
  progressPct: number;
  label?: string;
}) {
  const current = stepIndex(step);

  return (
    <div className="space-y-3">
      {label && <p className="text-sm font-medium">{label}</p>}
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500 rounded-full"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="flex justify-between gap-1">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`text-[10px] uppercase tracking-wide ${
              i <= current ? "text-accent" : "text-muted"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function AutoSyncToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-xs text-muted">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-white/20 bg-white/5 accent-accent"
      />
      Auto-sync daily
    </label>
  );
}

export default function IntegrationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [recentJobs, setRecentJobs] = useState<ImportJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{
    step: string;
    progressPct: number;
    message?: string;
  } | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvProgress, setCsvProgress] = useState<{
    step: string;
    progressPct: number;
  } | null>(null);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [premium, setPremium] = useState(false);

  const connectedParam = searchParams.get("connected");
  const errorParam = searchParams.get("error");
  const bannerMessage =
    !dismissedBanner && connectedParam
      ? `${connectedParam} connected successfully`
      : !dismissedBanner && errorParam
        ? `Connection failed: ${errorParam}`
        : null;

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/integrations/status");
    if (res.ok) {
      const data = await res.json();
      setConnections(data.connections ?? []);
      setRecentJobs(data.recentJobs ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("subscription_tier, subscription_status")
          .eq("user_id", user.id)
          .single();
        if (profile && active) {
          setPremium(
            isPremiumUser(
              profile.subscription_tier as SubscriptionTier,
              profile.subscription_status as SubscriptionStatus | null
            )
          );
        }
      }

      const res = await fetch("/api/integrations/status");
      if (!active) return;
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections ?? []);
        setRecentJobs(data.recentJobs ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const getConnection = (providerId: string) =>
    connections.find((c) => c.provider === providerId);

  const handleConnect = (providerId: string) => {
    router.push(`/api/integrations/connect/${providerId}`);
  };

  const handleDisconnect = async (providerId: string) => {
    await fetch(`/api/integrations/status?provider=${providerId}`, {
      method: "DELETE",
    });
    fetchStatus();
  };

  const handleAutoSync = async (providerId: string, autoSync: boolean) => {
    await fetch("/api/integrations/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerId, auto_sync: autoSync }),
    });
    fetchStatus();
  };

  const handleSync = async (providerId: IntegrationProviderId) => {
    setSyncing(providerId);
    setSyncProgress({ step: "parsing", progressPct: 10 });

    const progressInterval = setInterval(() => {
      setSyncProgress((prev) => {
        if (!prev) return prev;
        const steps = ["parsing", "validating", "scoring", "done"];
        const idx = steps.indexOf(prev.step);
        const nextIdx = Math.min(idx + 1, steps.length - 1);
        return {
          step: steps[nextIdx],
          progressPct: Math.min(prev.progressPct + 15, 90),
        };
      });
    }, 800);

    try {
      const res = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await res.json();

      clearInterval(progressInterval);

      if (res.ok) {
        setSyncProgress({
          step: "done",
          progressPct: 100,
          message: `${data.imported} imported${data.skipped ? `, ${data.skipped} skipped as duplicates` : ""}`,
        });
      } else {
        setSyncProgress({
          step: "done",
          progressPct: 100,
          message: data.error ?? "Sync failed",
        });
      }
      fetchStatus();
    } catch {
      clearInterval(progressInterval);
      setSyncProgress({ step: "done", progressPct: 100, message: "Sync failed" });
    } finally {
      setSyncing(null);
      setTimeout(() => setSyncProgress(null), 4000);
    }
  };

  const uploadCsv = async (file: File) => {
    setCsvUploading(true);
    setCsvResult(null);
    setCsvProgress({ step: "parsing", progressPct: 5 });

    const formData = new FormData();
    formData.append("file", file);

    try {
      setCsvProgress({ step: "validating", progressPct: 20 });
      const res = await fetch("/api/integrations/import/csv", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      setCsvProgress({ step: "scoring", progressPct: 80 });

      if (res.ok) {
        setCsvProgress({ step: "done", progressPct: 100 });
        setCsvResult(data.message ?? "Import complete");
      } else {
        setCsvProgress({ step: "done", progressPct: 100 });
        setCsvResult(data.error ?? "Import failed");
      }
      fetchStatus();
    } catch {
      setCsvProgress({ step: "done", progressPct: 100 });
      setCsvResult("Upload failed");
    } finally {
      setCsvUploading(false);
      setTimeout(() => setCsvProgress(null), 5000);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadCsv(file);
  };

  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="text-muted hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Integrations</h1>
            <p className="text-muted text-sm mt-1">
              Connect fitness apps and import your workout history
            </p>
          </div>
        </div>

        {bannerMessage && (
          <div className="glass rounded-xl p-3 flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            {bannerMessage}
            <button
              type="button"
              className="ml-auto text-muted"
              onClick={() => setDismissedBanner(true)}
            >
              ×
            </button>
          </div>
        )}

        <Card glow="accent">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-accent" />
              <CardTitle>Connected Apps</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!premium ? (
              <PremiumTease
                title="Strava, Garmin & auto-sync"
                subtitle="OAuth connections and background sync are Premium — free tier includes manual logging and CSV import."
                showPreview={false}
              />
            ) : null}
            {loading ? (
              <p className="text-sm text-muted">Loading connections...</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {OAUTH_PROVIDERS.map((source) => {
                  const conn = getConnection(source.id);
                  const isConnected = !!conn;

                  return (
                    <div
                      key={source.id}
                      className="glass rounded-xl p-4 space-y-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            <span>{PROVIDER_ICONS[source.id] ?? "📱"}</span>
                            {source.name}
                          </p>
                          <p className="text-xs text-muted mt-1">
                            {isConnected
                              ? conn.metadata?.demo
                                ? "Demo connection (add API keys for live sync)"
                                : "Connected"
                              : "Not connected"}
                          </p>
                          {conn?.last_sync_at && (
                            <p className="text-[10px] text-muted mt-1">
                              Last sync: {new Date(conn.last_sync_at).toLocaleString()}
                            </p>
                          )}
                          {conn?.sync_status === "error" && conn.sync_error && (
                            <p className="text-[10px] text-warning mt-1 line-clamp-2">
                              {conn.sync_error}
                            </p>
                          )}
                        </div>
                        {isConnected && conn.sync_status === "success" && (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        )}
                        {isConnected && conn.sync_status === "error" && (
                          <AlertCircle className="h-4 w-4 text-warning" />
                        )}
                      </div>

                      {isConnected ? (
                        <div className="space-y-2">
                          <AutoSyncToggle
                            enabled={conn.auto_sync}
                            onChange={(v) => handleAutoSync(source.id, v)}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="flex-1"
                              loading={syncing === source.id}
                              onClick={() =>
                                handleSync(source.id as IntegrationProviderId)
                              }
                            >
                              <RefreshCw className="h-3 w-3" />
                              Sync now
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDisconnect(source.id)}
                            >
                              <Unlink className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={!premium}
                          onClick={() => {
                            if (premium) handleConnect(source.id);
                          }}
                        >
                          {premium ? `Connect with ${source.name}` : "Premium required"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {syncProgress && (
              <ImportProgressBar
                step={syncProgress.step}
                progressPct={syncProgress.progressPct}
                label={syncProgress.message ?? "Syncing workouts..."}
              />
            )}
          </CardContent>
        </Card>

        <Card glow="endurance">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CloudUpload className="h-4 w-4 text-endurance" />
              <CardTitle>GPX / TCX Upload</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted mb-4">
              Import track files from Garmin, Strava exports, or other GPS devices. FIT files are
              supported in a future release.
            </p>
            <FileImportDropzone onImported={(msg) => setCsvResult(msg)} />
          </CardContent>
        </Card>

        <Card glow="endurance">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-endurance" />
              <CardTitle>CSV Upload</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                dragOver
                  ? "border-endurance bg-endurance/5"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <CloudUpload className="h-8 w-8 mx-auto text-muted mb-3" />
              <p className="text-sm font-medium">Drop your CSV file here</p>
              <p className="text-xs text-muted mt-1 mb-4">
                Supports date, sport, duration, distance, heart rate columns
              </p>
              <label className="inline-block cursor-pointer">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={csvUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadCsv(file);
                  }}
                />
                <Button variant="secondary" size="sm" loading={csvUploading}>
                  Browse files
                </Button>
              </label>
            </div>

            {csvProgress && (
              <ImportProgressBar
                step={csvProgress.step}
                progressPct={csvProgress.progressPct}
                label="Importing CSV..."
              />
            )}

            {csvResult && (
              <p className="text-sm text-center text-muted">{csvResult}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-strength" />
              <CardTitle>Manual Entry</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted mb-4">
              Log a workout manually with full sport-specific fields and live scoring.
            </p>
            <Link href="/activities/new">
              <Button variant="strength" className="w-full">
                Log Workout Manually
              </Button>
            </Link>
          </CardContent>
        </Card>

        {recentJobs.length > 0 && (
          <Card padding="sm">
            <CardHeader>
              <CardTitle>Import History</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {recentJobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center justify-between text-sm glass rounded-lg px-3 py-2"
                  >
                    <span className="capitalize">{job.source.replace("_", " ")}</span>
                    <span className="text-muted text-xs">
                      {job.imported} imported
                      {job.skipped > 0 && `, ${job.skipped} skipped`}
                      {job.failed > 0 && `, ${job.failed} failed`}
                    </span>
                    <span className="text-[10px] text-muted">
                      {new Date(job.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <p className="text-[10px] text-muted text-center pb-4">
          Production cron jobs (set <code className="text-foreground/60">CRON_SECRET</code>):
          daily integration sync{" "}
          <code className="text-foreground/60">GET /api/integrations/sync?cron=1</code>
          {" · "}
          leaderboard refresh{" "}
          <code className="text-foreground/60">GET /api/cron/leaderboard</code>
        </p>
      </div>
    </AppShell>
  );
}
