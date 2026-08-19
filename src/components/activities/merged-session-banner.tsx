"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Merge, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration } from "@/lib/utils/format";

/**
 * Shown on a session that was made by merging, which is the only place the
 * undo can live: merging deletes rows, so the athlete has to be able to find
 * their way back from the thing that replaced them.
 *
 * It also states what the merge did, in the athlete's own numbers, so a
 * session whose distance looks wrong months later can be explained without
 * digging through metadata.
 */

export interface MergedSessionLeg {
  id: string;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
}

export function MergedSessionBanner({
  activityId,
  legs,
  totalGapSeconds,
  mergedAt,
}: {
  activityId: string;
  legs: MergedSessionLeg[];
  totalGapSeconds: number;
  mergedAt: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnmerge() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}/unmerge`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not undo this merge.");
      router.push("/activities");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo this merge.");
      setWorking(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <Merge className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Merged from {legs.length} recordings
            {mergedAt ? ` on ${format(new Date(mergedAt), "d MMM yyyy")}` : ""}
          </p>
          <ul className="mt-2 space-y-1 text-xs tabular-nums text-muted">
            {legs.map((leg) => (
              <li key={leg.id}>
                {format(new Date(leg.startedAt), "d MMM, HH:mm")} ·{" "}
                {leg.distanceMeters ? `${formatDistance(leg.distanceMeters)} · ` : ""}
                {formatDuration(leg.durationSeconds)}
              </li>
            ))}
          </ul>
          {totalGapSeconds > 0 && (
            <p className="mt-2 text-xs text-muted">
              {formatDuration(totalGapSeconds)} of stopped time between them was not counted as
              training.
            </p>
          )}

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <div className="mt-3">
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted">
                  Split this back into {legs.length} sessions and re-score each one?
                </p>
                <Button size="sm" loading={working} onClick={handleUnmerge}>
                  Undo merge
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working}
                  onClick={() => setConfirming(false)}
                >
                  Keep merged
                </Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                <Undo2 className="h-4 w-4" />
                Undo merge
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
