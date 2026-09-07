"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_QUEUE_CHANGED,
  flushActivityQueue,
  getPendingActivityCount,
} from "@/lib/activities/offline-queue";
import { cn } from "@/lib/utils/cn";

/**
 * "Two workouts are on this phone and not on your account yet."
 *
 * THE QUEUE HAD NO WINDOW INTO IT. `getPendingActivityCount` was written,
 * exported, re-exported — and called from nowhere. No badge, no banner, no
 * settings row, and no offline indicator anywhere in the shell. An athlete
 * whose run was queued saw one toast at save time and then nothing, ever
 * again: the logbook does not show queued work, so the run simply was not
 * there, and the only honest conclusion available to them was that the app had
 * lost it.
 *
 * That mattered more after the submit path gained a timeout, because a flaky
 * connection now queues where it used to hang — the good outcome, but a good
 * outcome nobody can see is indistinguishable from the bad one.
 *
 * It renders NOTHING at zero, which is almost always. This is not a status bar
 * for a normal day; it is the app admitting it is holding something.
 */
export function PendingSyncBanner({ className }: { className?: string }) {
  const [count, setCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dropped, setDropped] = useState(0);

  // Who we are, once. The queue filters by owner so an unsent workout is never
  // uploaded by whoever signs in next — the count has to filter the same way.
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setUserId(data.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setCount(getPendingActivityCount(userId));
    refresh();
    // The queue writes to localStorage, whose `storage` event fires only in
    // OTHER tabs. This is a phone app with one tab, so the queue announces its
    // own changes instead.
    window.addEventListener(ACTIVITY_QUEUE_CHANGED, refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener(ACTIVITY_QUEUE_CHANGED, refresh);
      window.removeEventListener("online", refresh);
    };
  }, [userId]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setDropped(0);
    try {
      const result = await flushActivityQueue(userId);
      setDropped(result.dropped);
    } finally {
      setSyncing(false);
      setCount(getPendingActivityCount(userId));
    }
  }, [userId]);

  if (count === 0 && dropped === 0) return null;

  return (
    <div
      role="status"
      className={cn(
        "mb-3 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-3 py-2.5",
        className
      )}
    >
      <CloudOff className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        {count > 0 ? (
          <>
            <p className="text-sm font-medium text-warning">
              {count === 1 ? "1 workout" : `${count} workouts`} waiting to sync
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Saved on this phone, not lost. {count === 1 ? "It uploads" : "They upload"} on
              {" "}
              {count === 1 ? "its" : "their"} own when you have signal.
            </p>
          </>
        ) : (
          /*
            The queue gives up after five attempts or on an answer that will
            not change (see isPermanentFailure). Silently dropping a workout
            the athlete believes is saved is the one outcome worth interrupting
            them for — they can still log it again from memory today, and
            cannot in a month.
          */
          <p className="text-sm font-medium text-danger">
            {dropped === 1 ? "A workout" : `${dropped} workouts`} could not be saved and
            {dropped === 1 ? " has" : " have"} been removed. You will need to log{" "}
            {dropped === 1 ? "it" : "them"} again.
          </p>
        )}
      </div>
      {count > 0 && (
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-warning transition-colors hover:bg-warning/10 disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} aria-hidden />
          {syncing ? "Syncing" : "Sync now"}
        </button>
      )}
    </div>
  );
}
