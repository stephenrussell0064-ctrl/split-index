"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_QUEUE_CHANGED,
  flushActivityQueue,
  getPendingActivityCount,
  getPendingActivityCountOnDevice,
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
  const [droppedSports, setDroppedSports] = useState<string[]>([]);

  /*
    Who we are, once — WITHOUT asking the network.

    This used to call `auth.getUser()`, which is documented as performing a
    request to the auth server on every call. That is the wrong question to ask
    here for a reason that took a test to see: the queue filters by owner, and
    `ownedBy` treats a missing id as "signed out" rather than "anyone", so it
    excludes every item that names an owner. An unresolved owner therefore
    counts ZERO — and the one situation a network call reliably fails in is the
    one this banner exists for. Offline, with two workouts on the phone, it
    rendered nothing at all.

    `getSession()` reads the stored session instead, and only reaches the
    network if the access token has already expired. That is device-local
    state, which is the right kind of state to consult about device-local
    workouts.
  */
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setUserId(data.session?.user.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    /*
      And when even that cannot answer — an expired token with no signal — fall
      back to counting the device rather than counting nothing. On a shared
      phone that could include a workout someone else queued, which is a far
      smaller problem than telling an athlete their session is gone. Sending
      still filters by owner; only the count relaxes.
    */
    const refresh = () =>
      setCount(userId ? getPendingActivityCount(userId) : getPendingActivityCountOnDevice());
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
    if (!userId) return;
    setSyncing(true);
    setDroppedSports([]);
    try {
      const result = await flushActivityQueue(userId);
      setDroppedSports(result.droppedSports);
    } finally {
      setSyncing(false);
      setCount(getPendingActivityCount(userId));
    }
  }, [userId]);

  if (count === 0 && droppedSports.length === 0) return null;

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
            not change (see isPermanentFailure). This used to say "you will
            need to log it again", which was true when a queued save cleared
            the device draft mirror — and stopped being true the moment the
            mirror was kept until the SERVER accepts the workout.

            It is now the wrong thing to say for a worse reason than being
            stale: the session is sitting in the log form for that sport, and
            telling someone to re-enter it sends them to redo work they still
            have. So it names the sport and says where the workout is.
          */
          <p className="text-sm font-medium text-danger">
            {droppedSports.length === 1 ? "A workout" : `${droppedSports.length} workouts`} could
            not be uploaded. Still saved on this phone — open{" "}
            {droppedSports.map((s) => s.replace(/_/g, " ")).join(" and ")} logging to finish{" "}
            {droppedSports.length === 1 ? "it" : "them"}.
          </p>
        )}
      </div>
      {/*
        No button until we know whose workouts these are. Sending is the one
        operation that must not relax the owner filter — a flush with no id
        sends nothing and would leave the athlete pressing a button that
        silently does nothing. The count above is still true, and the automatic
        flush picks them up once the session resolves.
      */}
      {count > 0 && userId && (
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
