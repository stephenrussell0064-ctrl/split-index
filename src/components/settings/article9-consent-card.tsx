"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Article 9 explicit consent — the control, in one place, used by both the
 * Hybrid Plan intake and Settings.
 *
 * SHAPE RULES, AND WHY EACH ONE
 * -----------------------------
 * These are what make the consent valid rather than decorative, so none of
 * them is a style choice:
 *
 *  - The box starts UNTICKED and there is no default-on path. A pre-ticked box
 *    is not consent; it is an assumption with a checkbox drawn on it.
 *  - Agreeing needs two acts — read, then tick, then press. The button stays
 *    disabled until the box is ticked, so the affirmative action is the
 *    athlete's, not a side effect of arriving on the page.
 *  - Refusing is not a dead end and is never styled as the lesser option. No
 *    dark pattern, no greyed-out "no thanks", no interstitial nagging.
 *  - Withdrawal is ONE action, from here, and says plainly that it deletes.
 *    It is not buried behind a confirmation maze; the one confirm exists
 *    because the deletion is irreversible, not to add friction.
 *  - The wording comes from the server, which is the same string that gets
 *    stored with the event. A component with its own copy of the words would
 *    drift from the evidence, and the evidence is the point.
 */

interface ConsentState {
  granted: boolean;
  decidedAt: string | null;
  version: string | null;
  currentVersion: string;
  wording: string;
  staleVersion: boolean;
}

export function Article9ConsentCard({
  onChange,
}: {
  /** Lets the intake re-render its gated sections without a full reload. */
  onChange?: (granted: boolean) => void;
}) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/consent/article9");
      if (!res.ok) throw new Error();
      setState((await res.json()) as ConsentState);
    } catch {
      setError("Could not load your consent settings.");
    }
  }, []);

  useEffect(() => {
    // load() writes state only after awaiting the fetch, so nothing here is
    // synchronous. The rule traces into the callback and cannot tell the
    // writes sit behind an await; this is a plain load-on-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function grant() {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/consent/article9", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Echoing the version back is what stops a stale tab recording a
        // consent to wording that is no longer on screen.
        body: JSON.stringify({ acknowledgedVersion: state.currentVersion }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      setTicked(false);
      await load();
      onChange?.(true);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/consent/article9", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      setConfirmingWithdraw(false);
      await load();
      onChange?.(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted">Loading…</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
          Health data for the Hybrid Plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          {state.wording.split("\n\n").map((para) => (
            <p key={para.slice(0, 40)}>{para}</p>
          ))}
        </div>

        {state.granted ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium text-foreground">You have given this consent.</span>{" "}
              {state.decidedAt && (
                <span className="text-muted">
                  Recorded {new Date(state.decidedAt).toLocaleDateString()}.
                </span>
              )}
            </p>

            {state.staleVersion && (
              <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                We have updated what this consent covers since you agreed. Please read the
                text above and confirm again.
              </p>
            )}

            {confirmingWithdraw ? (
              <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
                <p className="text-sm">
                  Withdrawing deletes your health screening answers and injury history —
                  they are removed, not hidden. The Hybrid Plan and the injury Risk Index
                  switch off. Everything else in Split Index is unaffected.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" onClick={withdraw} disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Withdraw and delete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingWithdraw(false)} disabled={busy}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConfirmingWithdraw(true)} disabled={busy}>
                Withdraw consent and delete my answers
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={ticked}
                onChange={(e) => setTicked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent accent-[var(--accent)]"
              />
              <span>
                I explicitly consent to Split Index using my health information for the
                Hybrid Plan, as described above.
              </span>
            </label>

            <Button onClick={grant} disabled={!ticked || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Save my consent
            </Button>

            <p className="text-xs text-muted">
              You do not have to. Logging, your Split Index, predictions, the leaderboard,
              analytics and your subscription all work either way.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
