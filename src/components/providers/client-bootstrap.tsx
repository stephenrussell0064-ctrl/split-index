"use client";

import { useEffect } from "react";
import { detectBrowserTimezone } from "@/lib/utils/timezone";
import { flushActivityQueue } from "@/lib/activities/submit-activity";

/** Sync browser timezone to profile and retry queued workout submits on reconnect. */
export function ClientBootstrap() {
  useEffect(() => {
    const tz = detectBrowserTimezone();
    void fetch("/api/profile/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    });

    const onOnline = () => {
      void flushActivityQueue();
    };

    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void flushActivityQueue();
    }

    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
