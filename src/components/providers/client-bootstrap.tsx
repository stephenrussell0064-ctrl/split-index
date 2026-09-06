"use client";

import { useEffect } from "react";
import { detectBrowserTimezone } from "@/lib/utils/timezone";
import { flushActivityQueue } from "@/lib/activities/submit-activity";
import { createClient } from "@/lib/supabase/client";

/** Sync browser timezone to profile and retry queued workout submits on reconnect. */
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
    const flushMine = async () => {
      const { data } = await createClient().auth.getUser();
      await flushActivityQueue(data.user?.id ?? null);
    };

    const onOnline = () => {
      void flushMine();
    };

    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void flushMine();
    }

    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
