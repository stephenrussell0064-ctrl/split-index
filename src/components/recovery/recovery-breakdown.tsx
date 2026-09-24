import { Activity, HeartPulse, Layers, Wine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { RecoveryComponentKey, RecoveryScoreResult } from "@/lib/recovery/score";

const ICONS: Record<RecoveryComponentKey, typeof Activity> = {
  load: Activity,
  hrv: HeartPulse,
  density: Layers,
  alcohol: Wine,
};

/**
 * What the score is made of, component by component.
 *
 * The weight is shown next to every contributing component on purpose. A
 * composite that will not say how it weighted its inputs is asking to be
 * trusted rather than read, and the first question any athlete asks of a new
 * number is "what is this actually made of". The absent components are listed
 * too, greyed, with the thing that would switch them on — that is the honest
 * version of "we don't have your HRV", and it is also the only prompt in the
 * app that reliably gets one logged.
 */
export function RecoveryBreakdown({ result }: { result: RecoveryScoreResult }) {
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>What today&apos;s score is made of</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.components.map((component) => {
          const Icon = ICONS[component.key];
          const isAlcohol = component.key === "alcohol";
          const deduction = isAlcohol && (component.value ?? 0) < 0;

          return (
            <div
              key={component.key}
              className={cn(
                "flex gap-3 border-b border-white/[0.04] pb-4 last:border-0 last:pb-0",
                !component.present && !isAlcohol && "opacity-60"
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                  deduction ? "bg-danger/15 text-danger" : "bg-white/[0.04] text-muted"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium">{component.label}</p>
                  <p className="text-sm tabular-nums">
                    {component.value === null ? (
                      <span className="text-muted">Not contributing yet</span>
                    ) : deduction ? (
                      <span className="text-danger">{component.value} pts</span>
                    ) : isAlcohol ? (
                      <span className="text-success">No deduction</span>
                    ) : (
                      <>
                        <span className="font-semibold">{component.value}</span>
                        <span className="text-muted">
                          {" "}
                          · {Math.round(component.weight * 100)}% of the score
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {component.present && !isAlcohol && component.value !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${Math.max(2, component.value)}%` }}
                    />
                  </div>
                )}

                <p className="mt-2 text-xs leading-relaxed text-muted">{component.detail}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
