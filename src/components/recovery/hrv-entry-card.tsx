"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, HeartPulse, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Morning HRV entry, on the page where the number is actually used.
 *
 * It already existed, tucked under the Injury Risk panel three levels into
 * Analytics — which is a reasonable place for it if HRV only feeds injury
 * risk, and the wrong place now that it is 30% of the Recovery score. This is
 * the same endpoint and the same reading; it is only being asked for where the
 * athlete can see what it changes.
 */
export function HrvEntryCard({
  hrvToday,
  hrvBaseline,
}: {
  hrvToday: number | null;
  hrvBaseline: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit() {
    const hrvMs = Number(value);
    if (!Number.isFinite(hrvMs) || hrvMs <= 0) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/recovery/hrv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hrvMs }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("saved");
      setValue("");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <HeartPulse className="h-3.5 w-3.5" />
          Morning HRV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <p className="micro-label text-muted">Today</p>
            <p className="index-display text-2xl font-bold tabular-nums">
              {hrvToday != null ? `${Math.round(hrvToday)}ms` : "—"}
            </p>
          </div>
          <div>
            <p className="micro-label text-muted">Your baseline</p>
            <p className="index-display text-2xl font-bold tabular-nums text-muted">
              {hrvBaseline != null ? `${Math.round(hrvBaseline)}ms` : "Building"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            placeholder="rMSSD in ms"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="h-11 w-36 rounded-xl glass border border-white/10 px-4 text-base text-foreground placeholder:text-muted/40 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <Button variant="secondary" size="sm" onClick={submit} disabled={status === "saving"}>
            {status === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : status === "saved" ? (
              <Check className="h-4 w-4" />
            ) : (
              "Save"
            )}
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          {hrvBaseline == null
            ? "A single reading has nothing to compare against. Log for a few mornings and a personal baseline forms — then this starts contributing to your Recovery score."
            : "Taken on waking, before getting up, from any strap or app that reports rMSSD. Optional — the score works without it."}
        </p>
        {status === "error" && <p className="text-xs text-danger">That couldn&apos;t be saved.</p>}
      </CardContent>
    </Card>
  );
}
