"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Users2, Copy, Check, LogOut, Crown } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/social/user-avatar";
import type { SquadSummary } from "@/lib/social/types";

interface SquadsPanelProps {
  initialSquads: SquadSummary[];
  currentUserId: string;
}

function memberName(m: SquadSummary["members"][number]) {
  return m.displayName ?? m.username ?? "Athlete";
}

function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 font-mono text-xs tracking-wider text-muted transition-colors hover:border-accent/30 hover:text-foreground"
    >
      {code}
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function SquadCard({
  squad,
  currentUserId,
  onLeave,
}: {
  squad: SquadSummary;
  currentUserId: string;
  onLeave: (id: string) => void;
}) {
  return (
    <Card padding="sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">{squad.name}</span>
        </div>
        <InviteCode code={squad.inviteCode} />
      </div>

      <div className="mt-3 space-y-1.5">
        {squad.members.map((m, i) => (
          <div key={m.userId} className="flex items-center gap-2">
            <span className="w-4 text-xs text-muted">{i + 1}</span>
            <UserAvatar name={memberName(m)} avatarUrl={m.avatarUrl} size="sm" />
            <span className="flex-1 truncate text-sm">
              {m.userId === currentUserId ? "You" : memberName(m)}
              {i === 0 && squad.members.length > 1 && (
                <Crown className="ml-1 inline h-3 w-3 text-warning" />
              )}
            </span>
            <span className="tabular-nums text-sm font-medium text-muted">
              {m.currentSplitIndex ?? "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => onLeave(squad.id)}>
          <LogOut className="h-3.5 w-3.5" />
          Leave
        </Button>
      </div>
    </Card>
  );
}

export function SquadsPanel({ initialSquads, currentUserId }: SquadsPanelProps) {
  const [squads, setSquads] = useState(initialSquads);
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/squads");
    const data = await res.json();
    if (res.ok) setSquads(data.squads);
  }

  async function createSquad() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/squads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSquads(data.squads);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create squad");
    } finally {
      setCreating(false);
    }
  }

  async function joinSquad() {
    if (!inviteCode.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const res = await fetch("/api/squads/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSquads(data.squads);
      setInviteCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join squad");
    } finally {
      setJoining(false);
    }
  }

  async function leaveSquad(id: string) {
    await fetch(`/api/squads/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users2 className="h-4 w-4 text-accent" />
            <CardTitle>Squads</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">
            Small invite-based groups of people you actually train with — not anonymous bracket
            peers.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-end gap-2">
              <Input
                label="New squad name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Saturday crew"
              />
              <Button size="sm" loading={creating} onClick={createSquad}>
                Create
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Input
                label="Have an invite code?"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="ABCD123"
              />
              <Button size="sm" variant="secondary" loading={joining} onClick={joinSquad}>
                Join
              </Button>
            </div>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </CardContent>
      </Card>

      {squads.length > 0 ? (
        <div className="space-y-2">
          {squads.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <SquadCard squad={s} currentUserId={currentUserId} onLeave={leaveSquad} />
            </motion.div>
          ))}
        </div>
      ) : (
        <Card padding="md">
          <div className="flex flex-col items-center py-8 text-center">
            <Users2 className="mb-3 h-8 w-8 text-accent/60" />
            <p className="text-sm text-muted">No squads yet</p>
            <p className="mt-1 text-xs text-muted/70">
              Create one and share the invite code with your training partners.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
