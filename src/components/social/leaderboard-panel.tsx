"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Minus, Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/social/user-avatar";
import { formatIndex } from "@/lib/utils/format";
import {
  AGE_BRACKETS,
  INDEX_METRICS,
  LEADERBOARD_PERIODS,
  LEADERBOARD_SCOPES,
  WEIGHT_CLASSES,
  type IndexMetric,
  type LeaderboardScope,
} from "@/lib/social/constants";
import { getDisplayIndex } from "@/lib/social/leaderboard";
import { PremiumTease } from "@/components/premium/premium-tease";
import type { LeaderboardRow } from "@/lib/social/types";
import type { LeaderboardPeriod } from "@/types";
import { cn } from "@/lib/utils/cn";

interface LeaderboardPanelProps {
  initialRows: LeaderboardRow[];
  currentUserId: string;
  userCountry?: string | null;
  isPremium?: boolean;
  onCompare?: (username: string | null, userId: string) => void;
}

export function LeaderboardPanel({
  initialRows,
  currentUserId,
  userCountry,
  isPremium = false,
  onCompare,
}: LeaderboardPanelProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all_time");
  const [scope, setScope] = useState<LeaderboardScope>(
    isPremium ? "global" : "country"
  );
  const [metric, setMetric] = useState<IndexMetric>("split");
  const [ageBracket, setAgeBracket] = useState("18-29");
  const [weightClass, setWeightClass] = useState("middle");
  const [rows, setRows] = useState(initialRows);
  const [loading, setLoading] = useState(false);
  const skipInitialFetch = useRef(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period, scope, metric });
      if (scope === "country" && userCountry) params.set("country", userCountry);
      if (scope === "age") params.set("ageBracket", ageBracket);
      if (scope === "weight") params.set("weightClass", weightClass);

      const res = await fetch(`/api/social/leaderboard?${params}`);
      const data = await res.json();
      if (res.ok) setRows(data.rows);
    } finally {
      setLoading(false);
    }
  }, [period, scope, metric, ageBracket, weightClass, userCountry]);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    void fetchRows();
  }, [fetchRows]);

  return (
    <Card glow="accent">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            <CardTitle>Leaderboard</CardTitle>
          </div>
          <div className="flex gap-1 rounded-xl glass p-1">
            {LEADERBOARD_PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {LEADERBOARD_SCOPES.map((s) => {
            const locked = !isPremium && s.value !== "country";
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => {
                  if (locked) return;
                  setScope(s.value);
                }}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-medium transition-colors glass",
                  scope === s.value
                    ? "bg-white/10 text-foreground border border-white/15"
                    : "text-muted hover:text-foreground hover:bg-white/5",
                  locked && "opacity-50 cursor-not-allowed"
                )}
                title={locked ? "Premium required for global rankings" : undefined}
              >
                {s.label}
                {locked && " 🔒"}
              </button>
            );
          })}
        </div>

        {!isPremium && scope === "country" && (
          <p className="text-xs text-muted">
            Showing country rankings. Upgrade to compete globally.
          </p>
        )}

        {!isPremium && (
          <PremiumTease
            title="Global leaderboard rank"
            subtitle="See where you stand against athletes worldwide — unlock global, age, weight, and sport filters."
            showPreview={false}
            className="border border-white/[0.06]"
          />
        )}

        {scope === "sport" && (
          <div className="flex flex-wrap gap-2">
            {INDEX_METRICS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMetric(m.value)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium",
                  metric === m.value ? "bg-accent/20 text-accent" : "text-muted"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {scope === "age" && (
          <div className="flex flex-wrap gap-2">
            {AGE_BRACKETS.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => setAgeBracket(b.value)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs",
                  ageBracket === b.value ? "bg-accent/20 text-accent" : "text-muted"
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}

        {scope === "weight" && (
          <div className="flex flex-wrap gap-2">
            {WEIGHT_CLASSES.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setWeightClass(w.value)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs",
                  weightClass === w.value ? "bg-accent/20 text-accent" : "text-muted"
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        )}

        <div className={cn("space-y-1", loading && "opacity-50")}>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No rankings yet — log workouts to appear on the leaderboard
            </p>
          ) : (
            rows.map((entry, i) => {
              const isMe = entry.userId === currentUserId;
              const displayIndex = getDisplayIndex(entry, metric);
              const rankChange =
                entry.previousRank != null ? entry.previousRank - entry.rank : 0;

              return (
                <motion.div
                  key={entry.userId}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cn(
                    "flex items-center gap-3 rounded-xl p-3 transition-colors",
                    isMe ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-white/5"
                  )}
                >
                  <span
                    className={cn(
                      "w-8 text-center font-bold tabular-nums",
                      entry.rank <= 3 ? "text-warning" : "text-muted"
                    )}
                  >
                    {entry.rank}
                  </span>

                  <UserAvatar
                    name={entry.displayName ?? entry.username ?? "?"}
                    avatarUrl={entry.avatarUrl}
                    size="sm"
                  />

                  <div className="min-w-0 flex-1">
                    {entry.username ? (
                      <Link
                        href={`/social/profile/${entry.username}`}
                        className="block truncate text-sm font-medium hover:text-accent"
                      >
                        {entry.displayName ?? entry.username}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-medium">
                        {entry.displayName ?? "Athlete"}
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      {entry.country ?? "—"}
                      {entry.username && (
                        <span className="ml-1 opacity-60">@{entry.username}</span>
                      )}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums">
                      {formatIndex(displayIndex)}
                    </p>
                    <div className="flex items-center justify-end gap-1 text-xs">
                      {entry.trend > 0 ? (
                        <ArrowUp className="h-3 w-3 text-success" />
                      ) : entry.trend < 0 ? (
                        <ArrowDown className="h-3 w-3 text-danger" />
                      ) : (
                        <Minus className="h-3 w-3 text-muted" />
                      )}
                      <span
                        className={
                          entry.trend >= 0 ? "text-success" : "text-danger"
                        }
                      >
                        {entry.trend >= 0 ? "+" : ""}
                        {Math.round(entry.trend)}
                      </span>
                      {rankChange !== 0 && (
                        <span className="ml-1 text-muted">
                          ({rankChange > 0 ? "↑" : "↓"}
                          {Math.abs(rankChange)})
                        </span>
                      )}
                    </div>
                  </div>

                  {onCompare && entry.userId !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => onCompare(entry.username, entry.userId)}
                      className="hidden rounded-lg px-2 py-1 text-[10px] text-muted hover:bg-white/5 hover:text-accent sm:block"
                    >
                      Compare
                    </button>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
