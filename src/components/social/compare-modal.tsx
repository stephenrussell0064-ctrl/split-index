"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompareChart } from "@/components/social/compare-chart";
import { INDEX_METRICS } from "@/lib/social/constants";
import type { CompareSeries } from "@/lib/social/types";
import type { IndexMetric } from "@/lib/social/constants";
import { cn } from "@/lib/utils/cn";

interface CompareModalProps {
  open: boolean;
  onClose: () => void;
  initialUsername?: string;
  initialUserId?: string;
  friendOptions?: { username: string | null; userId: string; label: string }[];
}

export function CompareModal({
  open,
  onClose,
  initialUsername,
  initialUserId,
  friendOptions = [],
}: CompareModalProps) {
  const [username, setUsername] = useState(initialUsername ?? "");
  const [metric, setMetric] = useState<IndexMetric>("split");
  const [series, setSeries] = useState<CompareSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCompare = useCallback(
    async (targetUsername?: string, targetUserId?: string) => {
      await Promise.resolve();
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ metric, days: "30" });
        if (targetUserId) params.set("userId", targetUserId);
        else if (targetUsername) params.set("username", targetUsername);
        else return;

        const res = await fetch(`/api/social/compare?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load comparison");
        setSeries(data.series);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        setSeries([]);
      } finally {
        setLoading(false);
      }
    },
    [metric]
  );

  useEffect(() => {
    if (!open || (!initialUsername && !initialUserId)) return;
    const timer = setTimeout(() => {
      void loadCompare(initialUsername, initialUserId);
    }, 0);
    return () => clearTimeout(timer);
  }, [open, initialUsername, initialUserId, metric, loadCompare]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="glass-strong w-full max-w-lg rounded-2xl border border-white/10 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-accent" />
              <h2 className="font-semibold">Compare Index Trends</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {INDEX_METRICS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMetric(m.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  metric === m.value
                    ? "bg-accent text-accent-foreground"
                    : "glass text-muted hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {friendOptions.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {friendOptions.map((f) => (
                <button
                  key={f.userId}
                  type="button"
                  onClick={() => {
                    setUsername(f.username ?? "");
                    loadCompare(f.username ?? undefined, f.userId);
                  }}
                  className="rounded-lg glass px-3 py-1 text-xs text-muted hover:text-foreground"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="mb-4 flex gap-2">
            <Input
              placeholder="@username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              loading={loading}
              onClick={() => loadCompare(username.replace(/^@/, ""))}
            >
              Compare
            </Button>
          </div>

          {error && <p className="mb-3 text-xs text-danger">{error}</p>}

          <CompareChart series={series} />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
