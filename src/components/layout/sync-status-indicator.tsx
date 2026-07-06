"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function SyncStatusIndicator() {
  const [status, setStatus] = useState<{
    syncing: boolean;
    lastSync: string | null;
    error: boolean;
  }>({ syncing: false, lastSync: null, error: false });

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch("/api/integrations/status");
        if (!res.ok || !active) return;
        const data = await res.json();
        const connections = (data.connections ?? []) as Array<{
          sync_status: string;
          last_sync_at: string | null;
          auto_sync: boolean;
        }>;
        const syncing = connections.some((c) => c.sync_status === "syncing");
        const error = connections.some((c) => c.sync_status === "error");
        const lastSync = connections
          .map((c) => c.last_sync_at)
          .filter(Boolean)
          .sort()
          .reverse()[0] ?? null;
        setStatus({ syncing, lastSync, error });
      } catch {
        /* ignore */
      }
    }

    poll();
    const interval = setInterval(poll, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!status.syncing && !status.error && !status.lastSync) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status.syncing && "border-accent/30 text-accent bg-accent/5",
        status.error && !status.syncing && "border-warning/30 text-warning bg-warning/5",
        !status.syncing && !status.error && "border-white/10 text-muted"
      )}
      title={status.lastSync ? `Last sync: ${new Date(status.lastSync).toLocaleString()}` : undefined}
    >
      <RefreshCw className={cn("h-3 w-3", status.syncing && "animate-spin")} />
      {status.syncing ? "Syncing" : status.error ? "Sync issue" : "Synced"}
    </span>
  );
}
