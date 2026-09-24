import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UK_WEEKLY_UNIT_GUIDELINE } from "@/lib/recovery/alcohol";
import { cn } from "@/lib/utils/cn";

/**
 * Units per day over the last fortnight, against the weekly guideline.
 *
 * Plain CSS bars rather than a charting library: fourteen values with no
 * interaction worth having does not justify shipping a client component, and
 * this renders on the server with the rest of the page.
 *
 * The guideline line is drawn but the panel does not editorialise beyond it.
 * A running total next to a public-health number is useful; a training app
 * telling somebody they have a problem is not its job and would be wrong as
 * often as it was right.
 */
export function WeeklyUnitsPanel({
  daily,
  weeklyUnits,
}: {
  daily: { date: string; units: number }[];
  weeklyUnits: number;
}) {
  const max = Math.max(4, ...daily.map((d) => d.units));
  const overGuideline = weeklyUnits > UK_WEEKLY_UNIT_GUIDELINE;
  const dryDays = daily.slice(-7).filter((d) => d.units === 0).length;

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>Units logged</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="micro-label text-muted">Last 7 days</p>
            <p
              className={cn(
                "index-display text-3xl font-bold tabular-nums",
                overGuideline ? "text-warning" : "text-foreground"
              )}
            >
              {weeklyUnits}
              <span className="ml-1 text-sm font-medium text-muted">units</span>
            </p>
          </div>
          <div>
            <p className="micro-label text-muted">Alcohol-free days</p>
            <p className="index-display text-3xl font-bold tabular-nums text-foreground">
              {dryDays}
              <span className="ml-1 text-sm font-medium text-muted">of 7</span>
            </p>
          </div>
        </div>

        <div className="flex h-24 items-end gap-1">
          {daily.map((day) => {
            const height = day.units === 0 ? 2 : Math.max(6, (day.units / max) * 100);
            return (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={cn(
                    "w-full rounded-t-[4px]",
                    day.units === 0 ? "bg-white/[0.08]" : "bg-warning/70"
                  )}
                  style={{ height: `${height}%` }}
                  title={`${day.date}: ${day.units} units`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted">
          <span>{formatDay(daily[0]?.date)}</span>
          <span>{formatDay(daily[daily.length - 1]?.date)}</span>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          The UK Chief Medical Officers&apos; low-risk guideline is {UK_WEEKLY_UNIT_GUIDELINE} units
          a week, spread over three or more days. Sustained intake above it blunts training
          adaptation independently of any single night.
        </p>
      </CardContent>
    </Card>
  );
}

function formatDay(dateKey?: string): string {
  if (!dateKey) return "";
  return new Date(`${dateKey}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
