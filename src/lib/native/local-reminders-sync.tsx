"use client";

import { useEffect } from "react";
import { syncTrainingReminders } from "./local-reminders";
import type { DailyTrainingPayload } from "./daily-training";

/**
 * Renders nothing. Keeps the scheduled reminders in step with the plan the
 * screen is showing, from the same payload DailyTrainingSync hands the
 * widget — so the notification, the home screen and the app can never word
 * the same session three different ways.
 *
 * Mounted beside DailyTrainingSync for that reason, and keyed the same way:
 * on the payload's content, not its object identity. Every run costs a
 * cancel plus a schedule across the bridge.
 *
 * It does not ask for permission and does nothing until permission exists —
 * see the header on local-reminders.ts. On web, on a build without the
 * plugin, and for anyone who has not opted in, this is an effect that fires
 * and returns.
 */
export function LocalRemindersSync({ payload }: { payload: DailyTrainingPayload }) {
  const serialized = JSON.stringify(payload);

  useEffect(() => {
    void syncTrainingReminders(JSON.parse(serialized) as DailyTrainingPayload).then((result) => {
      if ("scheduled" in result && result.scheduled > 0) return;
      // Everything except an outright bridge failure is an ordinary state:
      // not opted in, no plan, nothing left today. Only "failed" means the
      // athlete opted into reminders and will silently not get them.
      if ("reason" in result && result.reason === "failed") {
        console.warn("[local-reminders] reminders not scheduled — the notification bridge rejected the call.");
      }
    });
  }, [serialized]);

  return null;
}
