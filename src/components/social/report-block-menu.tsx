"use client";

import { useState } from "react";
import { Ban, Flag, MoreVertical, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * Report and Block, on any surface that shows one athlete to another.
 *
 * App Store Guideline 1.2 requires both of these for an app with
 * user-generated content, and requires them to be reachable — not buried in a
 * settings screen. This component is the single implementation, so a new social
 * surface gets moderation by rendering one element rather than by remembering
 * to.
 *
 * The two actions are deliberately different in kind. BLOCK is instant, needs no
 * one's approval, and is the thing an athlete being harassed actually wants:
 * they act, the other person disappears, both ways. REPORT goes to a human queue
 * with a stated response time and does nothing automatically, because an
 * endpoint that hid accounts on receipt of a report would be a griefing tool.
 * Saying so in the sheet matters — an athlete who thinks reporting is instant
 * and then keeps seeing the person has been let down twice.
 */

const REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "sexual_content", label: "Sexual or explicit content" },
  { value: "violence", label: "Violence or threats" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "cheating", label: "Faked or cheated results" },
  { value: "spam", label: "Spam or advertising" },
  { value: "other", label: "Something else" },
];

export type ReportSubjectType = "profile" | "activity" | "squad" | "duel" | "feed_item";

interface ReportBlockMenuProps {
  userId: string;
  /** Shown in the confirmation copy so it is unambiguous who is being blocked. */
  displayName: string;
  subjectType?: ReportSubjectType;
  subjectId?: string | null;
  /** Called after a successful block so the surrounding list can drop this athlete without a reload. */
  onBlocked?: () => void;
  /** `icon` for a tight row (a feed item); `button` where there is room for a label. */
  variant?: "icon" | "button";
  className?: string;
}

export function ReportBlockMenu({
  userId,
  displayName,
  subjectType = "profile",
  subjectId = null,
  onBlocked,
  variant = "icon",
  className,
}: ReportBlockMenuProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report" | "block">("menu");
  const [reason, setReason] = useState<string>(REASONS[0]!.value);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"reported" | "blocked" | null>(null);

  function close() {
    setOpen(false);
    setMode("menu");
    setError(null);
    setDone(null);
    setDetails("");
  }

  async function submitReport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/social/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reason, subjectType, subjectId, details }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not send this report");
        return;
      }
      setDone("reported");
    } catch {
      setError("Could not send this report");
    } finally {
      setBusy(false);
    }
  }

  async function submitBlock() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/social/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not block this athlete");
        return;
      }
      setDone("blocked");
      onBlocked?.();
    } catch {
      setError("Could not block this athlete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Report or block ${displayName}`}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground",
            className
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          className={className}
        >
          <Flag className="h-4 w-4" />
          Report or block
        </Button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Report or block ${displayName}`}
          onClick={close}
        >
          <div
            className="mode-surface-elevated w-full max-w-md rounded-t-3xl border border-white/10 p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">
                {done === "blocked"
                  ? "Blocked"
                  : done === "reported"
                    ? "Report sent"
                    : mode === "report"
                      ? `Report ${displayName}`
                      : mode === "block"
                        ? `Block ${displayName}?`
                        : displayName}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg p-1 text-muted hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {done === "blocked" && (
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm text-foreground/85">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  You and {displayName} can no longer see each other anywhere in Split
                  Index. Any friendship between you has been removed.
                </p>
                <p className="text-xs text-muted">
                  You can undo this from Settings at any time. Unblocking does not restore
                  the friendship.
                </p>
                <Button className="w-full" onClick={close}>
                  Done
                </Button>
              </div>
            )}

            {done === "reported" && (
              <div className="space-y-3">
                <p className="text-sm text-foreground/85">
                  Thank you. A person on our team reviews every report, and looks at each
                  one within 24 hours.
                </p>
                <p className="text-xs text-muted">
                  Reporting does not hide this athlete from you on its own. If you would
                  rather not see them at all, block them as well — that takes effect
                  immediately.
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setDone(null);
                    setMode("block");
                  }}
                >
                  <Ban className="h-4 w-4" />
                  Also block {displayName}
                </Button>
                <Button className="w-full" onClick={close}>
                  Done
                </Button>
              </div>
            )}

            {!done && mode === "menu" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMode("report")}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 px-4 py-3 text-left text-sm transition-colors hover:bg-white/5"
                >
                  <Flag className="h-4 w-4 text-warning" />
                  <span>
                    <span className="block font-medium">Report</span>
                    <span className="block text-xs text-muted">
                      Send this to a human. Reviewed within 24 hours.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("block")}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 px-4 py-3 text-left text-sm transition-colors hover:bg-white/5"
                >
                  <Ban className="h-4 w-4 text-danger" />
                  <span>
                    <span className="block font-medium">Block</span>
                    <span className="block text-xs text-muted">
                      Takes effect now. You disappear from each other.
                    </span>
                  </span>
                </button>
              </div>
            )}

            {!done && mode === "report" && (
              <div className="space-y-3">
                <fieldset>
                  <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                    What is wrong?
                  </legend>
                  <div className="space-y-1.5">
                    {REASONS.map((r) => (
                      <label
                        key={r.value}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                          reason === r.value
                            ? "border-accent bg-accent/10"
                            : "border-white/10 hover:bg-white/5"
                        )}
                      >
                        <input
                          type="radio"
                          name="report-reason"
                          value={r.value}
                          checked={reason === r.value}
                          onChange={() => setReason(r.value)}
                          className="accent-[var(--accent)]"
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label
                    htmlFor="report-details"
                    className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted"
                  >
                    Anything else? (optional)
                  </label>
                  <textarea
                    id="report-details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                    rows={3}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
                    placeholder="What happened?"
                  />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button className="w-full" loading={busy} onClick={submitReport}>
                  Send report
                </Button>
              </div>
            )}

            {!done && mode === "block" && (
              <div className="space-y-3">
                <p className="text-sm text-foreground/85">
                  {displayName} will not be able to see your profile, your sessions or your
                  results, and you will not see theirs — in the feed, on leaderboards, in
                  squads or in duels. Any friendship between you is removed.
                </p>
                <p className="text-xs text-muted">
                  They are not told that you blocked them.
                </p>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button
                  className="w-full bg-danger text-white hover:bg-danger/90"
                  loading={busy}
                  onClick={submitBlock}
                >
                  <Ban className="h-4 w-4" />
                  Block {displayName}
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => setMode("menu")}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
