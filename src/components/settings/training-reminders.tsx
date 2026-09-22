"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  areTrainingRemindersSupported,
  clearTrainingReminders,
  getReminderPermission,
  requestTrainingReminders,
  DEFAULT_REMINDER_HOUR,
  type ReminderPermission,
} from "@/lib/native/local-reminders";

/**
 * The only thing in the app that asks for notification permission.
 *
 * iOS grants exactly one prompt per install. Spending it automatically — on
 * launch, or on whichever screen happens to mount a scheduler — is how an app
 * ends up with an opt-in rate it can never recover, because the second ask is
 * answered from the stored decision without showing anything. So the prompt
 * lives behind a button, on a page someone navigated to on purpose, next to a
 * sentence saying what they will actually receive.
 *
 * Self-hiding like WidgetStatus: nothing on web, nothing on a native build
 * that predates the plugin. A button that cannot work must not be offered.
 *
 * The denied state is a dead end by design rather than by neglect — calling
 * `requestPermissions` again would resolve "denied" without a prompt, so the
 * honest answer is to name the one place the decision can be changed.
 */
export function TrainingReminders() {
  const [permission, setPermission] = useState<ReminderPermission | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!areTrainingRemindersSupported()) return;
    let cancelled = false;
    void getReminderPermission().then((p) => {
      if (!cancelled) setPermission(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (permission === null || permission === "unavailable") return null;

  const hour = `${String(DEFAULT_REMINDER_HOUR).padStart(2, "0")}:00`;

  async function enable() {
    setBusy(true);
    try {
      setPermission(await requestTrainingReminders());
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await clearTrainingReminders();
      // Deliberately NOT setting permission to "denied": the OS grant is still
      // in place and only the athlete can revoke it. What changed is that
      // nothing is scheduled — which is what "off" means here.
      setPermission("prompt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4" aria-hidden />
          Training reminders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          A reminder at {hour} on each day your plan has a session, naming the session. Nothing
          on rest days. Scheduled on this device from the plan you already have — no reminder is
          sent from a server, and none is sent if your block ends.
        </p>

        {permission === "granted" ? (
          <div className="space-y-2">
            <p className="text-sm text-endurance">
              On. Reminders refresh whenever you open your plan.
            </p>
            <Button variant="secondary" onClick={disable} disabled={busy}>
              {busy ? "Turning off…" : "Turn off reminders"}
            </Button>
          </div>
        ) : permission === "denied" ? (
          <p className="text-sm text-muted">
            Notifications are turned off for Split Index. iOS only asks once, so this has to be
            changed in Settings › Notifications › Split Index.
          </p>
        ) : (
          <Button onClick={enable} disabled={busy}>
            {busy ? "Asking…" : "Turn on reminders"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
