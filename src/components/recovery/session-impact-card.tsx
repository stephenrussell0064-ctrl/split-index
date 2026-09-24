import { CalendarClock, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { SessionImpact, SessionVerdict } from "@/lib/recovery/alcohol";

const VERDICT_TONE: Record<SessionVerdict, string> = {
  as_planned: "text-success border-success/25 bg-success/[0.08]",
  reduce_intensity: "text-warning border-warning/25 bg-warning/[0.08]",
  easy_only: "text-warning border-warning/30 bg-warning/[0.1]",
  rest: "text-danger border-danger/30 bg-danger/[0.1]",
};

/**
 * What last night is likely to cost the next session.
 *
 * The two percentages are the point. "You drank a lot" is something the
 * athlete already knows; "expect about 8% off your endurance output at 4pm
 * today" is a number they can plan a session around, and it is the one thing
 * no other recovery app puts in front of them.
 *
 * Both are modelled estimates from a dose-response curve, not measurements,
 * and the card says so in the line under them rather than in a footnote
 * nobody reads.
 */
export function SessionImpactCard({
  impact,
  sessionAt,
  sessionLabel,
}: {
  impact: SessionImpact;
  sessionAt: Date;
  sessionLabel: string;
}) {
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          Impact on {sessionLabel}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className={cn("rounded-2xl border px-4 py-3", VERDICT_TONE[impact.verdict])}>
          <p className="text-sm font-semibold">{impact.headline}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{impact.detail}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="micro-label flex items-center gap-1 text-muted">
              <TrendingDown className="h-3 w-3" />
              Endurance
            </p>
            <p className="index-display mt-1 text-2xl font-bold tabular-nums text-endurance">
              −{impact.endurancePercent}%
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="micro-label flex items-center gap-1 text-muted">
              <TrendingDown className="h-3 w-3" />
              Peak force
            </p>
            <p className="index-display mt-1 text-2xl font-bold tabular-nums text-strength">
              −{impact.strengthPercent}%
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          Modelled for{" "}
          {sessionAt.toLocaleString("en-GB", {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {impact.hoursBetween != null && `, ${Math.round(impact.hoursBetween)}h after your last drink`}.
          These are estimates from published dose-response work on alcohol and next-day performance,
          scaled to your bodyweight and dose — not measurements of you.
        </p>

        {impact.strengthPercent > 0 && (
          <p className="text-xs leading-relaxed text-muted">
            The session cost is only half of it: a heavy dose after training suppresses muscle
            protein synthesis for around 24 hours, so the adaptation you were training for is
            blunted even when the session itself feels fine.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
