"use client";

import { useEffect } from "react";
import { detectBrowserTimezone } from "@/lib/utils/timezone";
import { flushActivityQueue, hasQueuedActivities } from "@/lib/activities/offline-queue";
import { createClient } from "@/lib/supabase/client";

/** Sync browser timezone to profile and retry queued workout submits on reconnect and on resume. */
export function ClientBootstrap() {
  useEffect(() => {
    const tz = detectBrowserTimezone();
    void fetch("/api/profile/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    });

    /*
      Flush only THIS athlete's queued workouts.

      The queue is localStorage, which belongs to the device rather than to the
      account, so an unsent run used to be uploaded by whoever signed in next —
      filing one person's session into another person's logbook. Passing the
      current user id makes the queue check ownership before it sends anything.
    */
    let flushing = false;
    const flushMine = async () => {
      // Two events can land together — a phone waking up is often `online` and
      // `visibilitychange` within the same tick. A second pass while the first
      // is mid-flight would re-send items it has not removed yet; the server's
      // idempotency key would catch the duplicate, but there is no reason to
      // make it.
      if (flushing) return;
      flushing = true;
      try {
        const { data } = await createClient().auth.getUser();
        await flushActivityQueue(data.user?.id ?? null);
      } finally {
        flushing = false;
      }
    };

    /*
      THE QUEUE HAD NO WAY BACK IN AFTER A BACKGROUNDED RECONNECT.

      This ran on mount and on `online`, and nothing else. `ClientBootstrap`
      lives in the root layout, so it stays mounted across every client-side
      navigation — meaning "on mount" is once per app launch, not once per
      screen.

      The case that left workouts stranded: signal comes back while the app is
      in the background. WKWebView does not reliably fire `online` for a
      transition it was not awake to observe, so the queued session sat there
      until the athlete force-quit and relaunched. They had already been told
      it would "sync when you're back online", and it was online.

      `visibilitychange` is what a resume actually looks like, on iOS, Android
      and the web alike, and needs no native dependency to observe.

      Gated on `hasQueuedActivities()` first: that is one localStorage read,
      where `flushMine` resolves the session before it can decide there is
      nothing to do. This fires on every tab focus, so the common case has to
      be free.
    */
    const flushIfPending = () => {
      if (!navigator.onLine || !hasQueuedActivities()) return;
      void flushMine();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") flushIfPending();
    };

    window.addEventListener("online", flushIfPending);
    document.addEventListener("visibilitychange", onVisible);
    if (navigator.onLine) {
      void flushMine();
    }

    return () => {
      window.removeEventListener("online", flushIfPending);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
