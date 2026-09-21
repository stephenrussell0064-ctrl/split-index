"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * Give Article 9 consent without leaving the Hybrid Plan.
 *
 * WHAT WAS WRONG
 * --------------
 * The plan screen explained that it needed permission to read health answers,
 * then sent the athlete to Settings to give it. That is three taps and a
 * context switch to answer a yes/no question they are being asked right now,
 * and the way back is not signposted — Settings does not know why they came.
 * Most people who bounce there do not come back.
 *
 * WHAT IT DOES
 * ------------
 * The same grant, in place: one checkbox, the real wording above it, and the
 * plan rebuilds as soon as it is ticked.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a shortcut around consent. The endpoint refuses a grant that does not
 * quote the wording version currently shipping (`acknowledgedVersion`), so
 * this fetches the live wording and shows it before the box can be ticked —
 * the same contract the Settings card honours. Consent that was not informed
 * is not consent, and a tick box is only lighter to operate, not lighter in
 * what it means.
 *
 * Withdrawal deliberately stays in Settings. Granting and revoking are not
 * symmetrical actions and should not sit under the same control: one is a
 * decision made in passing, the other deserves the page that explains what
 * happens to the data already held.
 */

interface ConsentState {
  currentVersion: string;
  wording: string;
}

export function InlineArticle9Consent({ onGranted }: { onGranted: () => void }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/consent/article9");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ConsentState;
        if (alive) setState(body);
      } catch {
        // Leaving `state` null renders the Settings route below, which always
        // works. A consent control that cannot prove which wording it is
        // showing must not offer the tick box at all.
        if (alive) setState(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const grant = useCallback(async () => {
    if (!state || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/consent/article9", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgedVersion: state.currentVersion }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onGranted();
    } catch {
      setError("That did not save. Try again, or use Settings.");
      setSaving(false);
    }
  }, [state, saving, onGranted]);

  if (!state) {
    return (
      <Link
        href="/settings"
        className="mt-5 inline-flex min-h-11 items-center rounded-2xl bg-accent px-5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
      >
        Go to Settings
      </Link>
    );
  }

  return (
    <div className="mt-5">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-xs leading-relaxed text-muted">
        {state.wording}
      </div>

      {/*
        A real checkbox, not a styled div: it is reachable by keyboard and by
        VoiceOver without any work, and min-h-11 keeps the tap target at
        Apple's 44pt minimum.
      */}
      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={false}
          disabled={saving}
          onChange={grant}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-white/20 bg-transparent accent-accent"
        />
        <span className="text-sm leading-relaxed text-foreground/90">
          {saving ? "Saving…" : "I agree — use my health answers to screen and build my plan"}
        </span>
      </label>

      {error && <p className="mt-2 text-xs text-warning">{error}</p>}

      <p className="mt-3 text-xs leading-relaxed text-muted/80">
        Nothing else in Split Index needs this — your logging, scores and history all work either way. You can withdraw
        it at any time in{" "}
        <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
