"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Swords, Check, X, Ban, Crown } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { UserAvatar } from "@/components/social/user-avatar";
import { SPORTS } from "@/lib/constants/sports";
import { format } from "date-fns";
import { formatIndex } from "@/lib/utils/format";
import type { DuelMetric, DuelWithStandings } from "@/lib/social/types";
import type { FriendConnection } from "@/lib/social/types";

/** "speed"/"strength" duels compare raw Split Index (0–1000 internal) scores — rescale for display. "sessions"/"load" are plain counts/AU, not index-scale. */
function formatDuelScore(score: number, metric: DuelMetric): string {
  return metric === "speed" || metric === "strength"
    ? formatIndex(score)
    : Math.round(score).toLocaleString();
}

const METRIC_LABELS: Record<DuelMetric, string> = {
  sessions: "Most sessions logged",
  load: "Most training load (AU)",
  speed: "Best endurance score (speed)",
  strength: "Best strength score",
};

const DURATION_OPTIONS = [
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "30 days" },
];

interface DuelsPanelProps {
  initialDuels: DuelWithStandings[];
  friends: FriendConnection[];
  currentUserId: string;
}

function participantName(p: DuelWithStandings["challenger"]) {
  return p.displayName ?? p.username ?? "Athlete";
}

function DuelRow({
  duel,
  currentUserId,
  onRespond,
}: {
  duel: DuelWithStandings;
  currentUserId: string;
  onRespond?: (id: string, action: "accept" | "decline" | "cancel") => void;
}) {
  const sport = duel.sport ? SPORTS.find((s) => s.id === duel.sport) : null;
  const iAmChallenger = duel.challenger.userId === currentUserId;
  const me = iAmChallenger ? duel.challenger : duel.opponent;
  const them = iAmChallenger ? duel.opponent : duel.challenger;
  const total = me.score + them.score || 1;

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {METRIC_LABELS[duel.metric]}
          {sport ? ` · ${sport.icon} ${sport.name}` : ""}
        </span>
        <span>
          {duel.ended ? "Ended" : `Ends ${format(new Date(duel.endDate), "d MMM")}`}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2">
          <UserAvatar name="You" avatarUrl={null} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              You
              {duel.leaderId === me.userId && (
                <Crown className="ml-1 inline h-3 w-3 text-warning" />
              )}
            </p>
            <p className="text-lg font-bold tabular-nums">{formatDuelScore(me.score, duel.metric)}</p>
          </div>
        </div>
        <Swords className="h-4 w-4 shrink-0 text-muted" />
        <div className="flex flex-1 items-center justify-end gap-2 text-right">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {duel.leaderId === them.userId && (
                <Crown className="mr-1 inline h-3 w-3 text-warning" />
              )}
              {participantName(them)}
            </p>
            <p className="text-lg font-bold tabular-nums">{formatDuelScore(them.score, duel.metric)}</p>
          </div>
          <UserAvatar name={participantName(them)} avatarUrl={them.avatarUrl} size="sm" />
        </div>
      </div>

      {duel.status === "accepted" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-warning transition-all duration-500"
            style={{ width: `${Math.round((me.score / total) * 100)}%` }}
          />
        </div>
      )}

      {duel.status === "pending" && onRespond && (
        <div className="mt-3 flex justify-end gap-2">
          {!iAmChallenger ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => onRespond(duel.id, "accept")}>
                <Check className="h-3 w-3" />
                Accept
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRespond(duel.id, "decline")}>
                <X className="h-3 w-3" />
                Decline
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onRespond(duel.id, "cancel")}>
              <Ban className="h-3 w-3" />
              Cancel invite
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function DuelsPanel({ initialDuels, friends, currentUserId }: DuelsPanelProps) {
  const [duels, setDuels] = useState(initialDuels);
  const [friendId, setFriendId] = useState(friends[0]?.profile.userId ?? "");
  const [metric, setMetric] = useState<DuelMetric>("sessions");
  const [sport, setSport] = useState("");
  const [days, setDays] = useState("7");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/duels");
    const data = await res.json();
    if (res.ok) setDuels(data.duels);
  }

  async function sendDuel() {
    if (!friendId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/duels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId, metric, sport: sport || undefined, days: Number(days) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send duel");
    } finally {
      setSending(false);
    }
  }

  async function respond(id: string, action: "accept" | "decline" | "cancel") {
    await fetch(`/api/duels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await refresh();
  }

  const pending = duels.filter((d) => d.status === "pending");
  const active = duels.filter((d) => d.status === "accepted" && !d.ended);
  const past = duels.filter(
    (d) => (d.status === "accepted" && d.ended) || d.status === "declined" || d.status === "cancelled"
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-accent" />
            <CardTitle>Challenge a friend</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {friends.length === 0 ? (
            <p className="text-sm text-muted">
              Add a friend first — duels are just between the two of you, no platform-wide
              leaderboard needed.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Friend"
                  value={friendId}
                  onChange={(e) => setFriendId(e.target.value)}
                  options={friends.map((f) => ({
                    value: f.profile.userId,
                    label: f.profile.displayName ?? f.profile.username ?? "Friend",
                  }))}
                />
                <Select
                  label="Winning metric"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as DuelMetric)}
                  options={Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <Select
                  label="Sport"
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  options={[{ value: "", label: "Any sport" }, ...SPORTS.map((s) => ({ value: s.id, label: s.name }))]}
                />
                <Select
                  label="Duration"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  options={DURATION_OPTIONS}
                />
              </div>
              {error && <p className="text-xs text-danger">{error}</p>}
              <Button size="sm" loading={sending} onClick={sendDuel}>
                <Swords className="h-3.5 w-3.5" />
                Send duel invite
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Pending
          </p>
          <div className="space-y-2">
            {pending.map((d, i) => (
              <motion.div key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <DuelRow duel={d} currentUserId={currentUserId} onRespond={respond} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Active
          </p>
          <div className="space-y-2">
            {active.map((d, i) => (
              <motion.div key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <DuelRow duel={d} currentUserId={currentUserId} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Past
          </p>
          <div className="space-y-2 opacity-70">
            {past.map((d) => (
              <DuelRow key={d.id} duel={d} currentUserId={currentUserId} />
            ))}
          </div>
        </div>
      )}

      {duels.length === 0 && (
        <Card padding="md">
          <div className="flex flex-col items-center py-8 text-center">
            <Swords className="mb-3 h-8 w-8 text-accent/60" />
            <p className="text-sm text-muted">No duels yet</p>
            <p className="mt-1 text-xs text-muted/70">
              Challenge a friend above — a real, closeable rivalry that works even with just the
              two of you.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
