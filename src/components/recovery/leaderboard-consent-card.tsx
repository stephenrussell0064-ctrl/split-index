"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Joining and leaving the streak leaderboard.
 *
 * The shape rules are the ones Article9ConsentCard sets out, and they are what
 * make this consent valid rather than decorative — so none of them is a style
 * choice:
 *
 *  - The box starts UNTICKED. A pre-ticked box is an assumption with a
 *    checkbox drawn on it.
 *  - Two acts to agree: tick, then press. The button stays disabled until the
 *    box is ticked, so the affirmative action is the athlete's.
 *  - Leaving is one press, never styled as the lesser option, and says plainly
 *    what happens.
 *  - The wording is fetched from the server — the same string the event record
 *    stores. A component with its own copy would drift from the evidence.
 *
 * What differs from the Hybrid Plan's card: leaving deletes nothing, because
 * nothing derived is stored. Saying "we keep nothing" is only honest because
 * the board is a view, so it says exactly that rather than borrowing the other
 * card's deletion language.
 */

interface ConsentState {
  granted: boolean;
  decidedAt: string | null;
  version: string | null;
  currentVersion: string;
  wording: string;
  staleVersion: boolean;
}

export function LeaderboardConsentCard() {
  const router = useRouter();
  const [state, setState] = useState<ConsentState | null>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/consent/leaderboard");
      if (!res.ok) throw new Error();
      setState((await res.json()) as ConsentState);
    } catch {
      setError("Could not load your leaderboard setting.");
    }
  }, []);

  useEffect(() => {
    // Writes happen after an await, so nothing here is synchronous; the rule
    // traces into the callback and cannot tell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(method: "POST" | "DELETE") {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/consent/leaderboard", {
        method,
        headers: { "Content-Type": "application/json" },
        body:
          method === "POST"
            ? JSON.stringify({ acknowledgedVersion: state.currentVersion })
            : undefined,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      setTicked(false);
      await load();
      router.refresh();
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
    <Card padding="lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
          {state.granted ? "You are on the leaderboard" : "Join the leaderboard"}
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
            {state.decidedAt && (
              <p className="text-sm text-muted">
                Joined {new Date(state.decidedAt).toLocaleDateString()}.
              </p>
            )}

            {state.staleVersion && (
              <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                We have updated what this covers since you agreed. Please read the text above
                and confirm again.
              </p>
            )}

            <Button variant="outline" onClick={() => act("DELETE")} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Leave the leaderboard
            </Button>
            <p className="text-xs text-muted">
              You disappear from it immediately. Your drinks, your Recovery score and everything
              else stay exactly as they are.
            </p>
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
                I explicitly consent to other Split Index athletes seeing how many days it has
                been since my last logged drink, as described above.
              </span>
            </label>

            <Button onClick={() => act("POST")} disabled={!ticked || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Join the leaderboard
            </Button>

            <p className="text-xs text-muted">
              You do not have to. Logging, your Recovery score, your session forecast and the
              leaderboard itself all work either way — you just will not appear on it.
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
