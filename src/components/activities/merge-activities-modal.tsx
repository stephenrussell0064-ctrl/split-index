"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Merge } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { formatDistance, formatDuration, formatPace, formatSpeed } from "@/lib/utils/format";
import type { LogbookEntry } from "@/lib/activities/logbook-query";

/**
 * "Are you sure" is not enough for an operation that deletes scored training.
 *
 * So this dialog does not ask the athlete to trust it: it asks the server what
 * the merge would produce (the same code path that will run it, in dry-run
 * mode), then shows the actual resulting session — its distance, its duration,
 * its pace — next to the sessions it replaces, along with every warning the
 * server raised. What is on screen when they press Merge is what they get.
 *
 * The two facts that matter most to an athlete looking at this are stated
 * outright rather than left to be inferred: the dead time between the
 * recordings is NOT being added to their training time, and the merge can be
 * undone from the merged session's page afterwards.
 */

interface MergePreview {
  survivorId: string;
  absorbedIds: string[];
  legs: Array<{
    id: string;
    startedAt: string;
    durationSeconds: number;
    distanceMeters: number | null;
    gapBeforeSeconds: number;
  }>;
  merged: {
    sport: string;
    duration_seconds: number;
    distance_meters: number | null;
    elevation_meters: number | null;
    avg_pace_seconds_per_km: number | null;
    avg_split_seconds: number | null;
    avg_heart_rate: number | null;
    session_type: string | null;
  };
  routePoints: number;
  totalGapSeconds: number;
  warnings: string[];
}

function paceLine(merged: MergePreview["merged"]): string | null {
  if (merged.avg_split_seconds != null) {
    const m = Math.floor(merged.avg_split_seconds / 60);
    const s = Math.round(merged.avg_split_seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}/500m`;
  }
  if (merged.avg_pace_seconds_per_km == null) return null;
  return merged.sport === "outdoor_cycling"
    ? formatSpeed(merged.avg_pace_seconds_per_km)
    : formatPace(merged.avg_pace_seconds_per_km);
}

function gapLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return formatDuration(seconds);
}

/**
 * Mounted only while it is open (the caller renders it conditionally, keyed on
 * the selection), so the preview is fetched once per opening and the dialog
 * never shows numbers left over from a previous selection.
 */
export function MergeActivitiesModal({
  entries,
  onClose,
  onMerged,
}: {
  /** The selected sessions, in the order the logbook showed them. */
  entries: LogbookEntry[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activityIds = entries.map((e) => e.id);
  const idsKey = [...activityIds].sort().join(",");

  useEffect(() => {
    let cancelled = false;

    // The dialog never computes the merged session itself. Two
    // implementations of "what does merging these produce" would eventually
    // disagree, and the one the athlete approved would not be the one that ran.
    fetch("/api/activities/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activityIds: idsKey.split(","), dryRun: true }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error ?? "These sessions cannot be merged.");
        setPreview(data.preview as MergePreview);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "These sessions cannot be merged.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  async function handleMerge() {
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/activities/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activityIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not merge these sessions.");
      onMerged();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not merge these sessions.");
    } finally {
      setMerging(false);
    }
  }

  const merged = preview?.merged;
  const pace = merged ? paceLine(merged) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Merge sessions"
        className={cn(
          "relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#12121a] p-6 shadow-xl",
          "animate-in fade-in slide-in-from-bottom-4 duration-200"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15">
            <Merge className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Merge into one session?</h2>
            <p className="mt-1 text-sm text-muted">
              These {entries.length} recordings will become a single session, scored as one
              continuous effort.
            </p>
          </div>
        </div>

        {loading && <p className="mt-5 text-sm text-muted">Working out what this would produce…</p>}

        {preview && merged && (
          <>
            <ul className="mt-5 space-y-1.5">
              {preview.legs.map((leg) => (
                <li key={leg.id}>
                  {leg.gapBeforeSeconds > 0 && (
                    <p className="py-1 pl-1 text-[11px] tabular-nums text-muted/70">
                      ↕ {gapLabel(leg.gapBeforeSeconds)} stopped — not counted
                    </p>
                  )}
                  <div className="flex items-baseline justify-between gap-3 rounded-xl border border-white/[0.08] px-3 py-2 text-sm tabular-nums">
                    <span className="text-muted">
                      {format(new Date(leg.startedAt), "d MMM, HH:mm")}
                    </span>
                    <span>
                      {leg.distanceMeters ? `${formatDistance(leg.distanceMeters)} · ` : ""}
                      {formatDuration(leg.durationSeconds)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center gap-2 text-muted">
              <div className="h-px flex-1 bg-white/10" />
              <ArrowRight className="h-4 w-4 rotate-90" />
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
              <p className="micro-label text-muted">One session</p>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm tabular-nums">
                {merged.distance_meters != null && (
                  <span className="font-semibold">{formatDistance(merged.distance_meters)}</span>
                )}
                <span className="font-semibold">{formatDuration(merged.duration_seconds)}</span>
                {pace && <span className="font-semibold text-accent">{pace}</span>}
                {merged.avg_heart_rate != null && (
                  <span className="text-muted">{merged.avg_heart_rate} bpm</span>
                )}
                {merged.elevation_meters ? (
                  <span className="text-muted">↑ {Math.round(merged.elevation_meters)} m</span>
                ) : null}
              </p>
              {preview.routePoints > 0 && (
                <p className="mt-1.5 text-[11px] text-muted">
                  Routes joined in the order they were run.
                </p>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {preview.warnings.map((warning) => (
                <p key={warning} className="flex gap-2 text-xs text-muted">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
                  <span>{warning}</span>
                </p>
              ))}
              <p className="flex gap-2 text-xs text-muted">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  The other {preview.absorbedIds.length === 1 ? "recording" : "recordings"} will stop
                  appearing in your logbook, and any reactions or comments on{" "}
                  {preview.absorbedIds.length === 1 ? "it" : "them"} are lost for good. You can undo
                  the merge itself from the merged session at any time.
                </span>
              </p>
            </div>
          </>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={merging}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={merging}
            disabled={!preview || loading}
            onClick={handleMerge}
          >
            Merge
          </Button>
        </div>
      </div>
    </div>
  );
}
