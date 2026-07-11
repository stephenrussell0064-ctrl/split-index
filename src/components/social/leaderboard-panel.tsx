"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Minus, Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/social/user-avatar";
import { formatIndex, formatWeight } from "@/lib/utils/format";
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
import { tierForScore } from "@/lib/scoring/split-strength-engine";
import {
  formatPredictionLabel,
  formatRiegelPrediction,
} from "@/lib/scoring/presentation";
import type { LeaderboardDetail } from "@/lib/social/queries";
import type { LeaderboardRow } from "@/lib/social/types";
import type { LeaderboardPeriod } from "@/types";
import { cn } from "@/lib/utils/cn";

const PLACEHOLDER_DETAIL: LeaderboardDetail = {
  topLifts: [
    { name: "Bench Press", estimated1RmKg: 98.2, tier: "Advanced" },
    { name: "Back Squat", estimated1RmKg: 128.5, tier: "Advanced" },
  ],
  racePredictions: { "5000": 1194, "10000": 2510 },
};

function LeaderboardDetailCard({
  detail,
  isPremium,
}: {
  detail: LeaderboardDetail | null;
  isPremium: boolean;
}) {
  const content = isPremium ? detail : PLACEHOLDER_DETAIL;
  if (!content) {
    return <p className="px-3 py-3 text-xs text-muted">Loading…</p>;
  }

  const inner = (
    <div className="space-y-3 px-1 py-2 text-xs">
      {content.topLifts.length > 0 && (
        <div>
          <p className="micro-label text-muted mb-1.5">Top lifts</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {content.topLifts.map((lift) => (
              <li key={lift.name} className="flex justify-between gap-2 glass rounded-lg px-2.5 py-1.5">
                <span>{lift.name}</span>
                <span className="tabular-nums font-medium">
                  {formatWeight(lift.estimated1RmKg)}
                  {lift.tier ? <span className="ml-1 text-[10px] text-muted">{lift.tier}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {content.racePredictions && (
        <div>
          <p className="micro-label text-muted mb-1.5">Race predictions</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {Object.entries(content.racePredictions).map(([dist, sec]) => (
              <li key={dist} className="flex justify-between gap-2 glass rounded-lg px-2.5 py-1.5 tabular-nums">
                <span className="text-muted">{formatPredictionLabel(dist)}</span>
                <span className="font-medium">{formatRiegelPrediction(sec)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {content.topLifts.length === 0 && !content.racePredictions && (
        <p className="text-muted">No logged sessions to show yet.</p>
      )}
    </div>
  );

  if (isPremium) return inner;

  return (
    <PremiumTease
      title="Full performance detail"
      subtitle="Unlock top lifts and race predictions for every athlete with Premium."
      className="mx-1 my-2"
    >
      {inner}
    </PremiumTease>
  );
}

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
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, LeaderboardDetail>>({});
  const skipInitialFetch = useRef(true);

  const toggleExpanded = useCallback(
    (userId: string) => {
      setExpandedUserId((prev) => (prev === userId ? null : userId));
      if (!isPremium || detailCache[userId]) return;
      fetch(`/api/social/leaderboard/detail?userId=${userId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((detail: LeaderboardDetail | null) => {
          if (detail) setDetailCache((prev) => ({ ...prev, [userId]: detail }));
        })
        .catch(() => {});
    },
    [isPremium, detailCache]
  );

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

        {/* Free for everyone — ranking by Split/Endurance/Strength doesn't require a premium scope. */}
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
              const tier = tierForScore(displayIndex);
              const rankChange =
                entry.previousRank != null ? entry.previousRank - entry.rank : 0;
              const isExpanded = expandedUserId === entry.userId;

              return (
                <div key={entry.userId}>
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(entry.userId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") toggleExpanded(entry.userId);
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-xl p-3 transition-colors cursor-pointer",
                    isMe ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-white/5",
                    isExpanded && "bg-white/5"
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
                    <div className="flex items-center gap-1.5">
                      {entry.username ? (
                        <Link
                          href={`/social/profile/${entry.username}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-sm font-medium hover:text-accent"
                        >
                          {entry.displayName ?? entry.username}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium">
                          {entry.displayName ?? "Athlete"}
                        </p>
                      )}
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted">
                        {tier}
                      </span>
                    </div>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompare(entry.username, entry.userId);
                      }}
                      className="hidden rounded-lg px-2 py-1 text-[10px] text-muted hover:bg-white/5 hover:text-accent sm:block"
                    >
                      Compare
                    </button>
                  )}
                </motion.div>
                {isExpanded && (
                  <LeaderboardDetailCard
                    detail={detailCache[entry.userId] ?? null}
                    isPremium={isPremium}
                  />
                )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
