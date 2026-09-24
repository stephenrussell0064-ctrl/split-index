import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { SessionImpact, SessionVerdict } from "@/lib/recovery/alcohol";

const DOT: Record<SessionVerdict, string> = {
  as_planned: "bg-success",
  reduce_intensity: "bg-warning",
  easy_only: "bg-warning",
  rest: "bg-danger",
};

/**
 * The same forecast at three times of day.
 *
 * This is the answer to the question the athlete is actually asking after a
 * night out — not "how bad is it" but "when can I train". A single verdict for
 * a single assumed time cannot answer that; three side by side show the cost
 * falling away through the day, and make the decision to push a session back
 * six hours an informed one rather than a guess.
 */
export function SessionTimingStrip({
  options,
}: {
  options: { label: string; at: Date; impact: SessionImpact }[];
}) {
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>If you train at…</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map((option) => (
          <div
            key={option.label}
            className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[option.impact.verdict])} />
              <div>
                <p className="text-sm font-medium">{option.label}</p>
                <p className="text-xs text-muted">{option.impact.headline}</p>
              </div>
            </div>
            <p className="shrink-0 text-right text-xs tabular-nums text-muted">
              <span className="text-endurance">−{option.impact.endurancePercent}%</span>
              {" / "}
              <span className="text-strength">−{option.impact.strengthPercent}%</span>
            </p>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-muted">
          Endurance / peak force, estimated against what you&apos;d produce fully recovered.
        </p>
      </CardContent>
    </Card>
  );
}
