"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gramsToUnits } from "@/lib/recovery/alcohol";
import type { DrinkRow } from "@/lib/recovery/data";

/**
 * The drink history, with a delete on every row.
 *
 * Undo is the feature that makes the logger usable. The entry flow is a grid
 * of large buttons designed to be tapped quickly and slightly hungover, so
 * mis-taps are not an edge case — and an athlete who cannot correct one stops
 * logging entirely, which costs the model far more than the occasional wrong
 * row ever would.
 */
export function DrinkHistoryList({ drinks }: { drinks: DrinkRow[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [erasing, setErasing] = useState(false);

  async function remove(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/recovery/drinks/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  /**
   * Erase the lot.
   *
   * This is a privacy control rather than a convenience, and it is part of
   * what keeps this data out of the explicit-consent regime — the athlete has
   * to be able to take it all back in one action, not forty. The single
   * confirmation exists because the deletion is irreversible, not to add
   * friction to the decision.
   */
  async function eraseAll() {
    setErasing(true);
    try {
      const res = await fetch("/api/recovery/drinks", { method: "DELETE" });
      if (res.ok) {
        setConfirmingErase(false);
        router.refresh();
      }
    } finally {
      setErasing(false);
    }
  }

  if (drinks.length === 0) {
    return (
      <Card padding="lg">
        <CardHeader>
          <CardTitle>Recent drinks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Nothing logged in the last 30 days. Log a drink above and it will start showing in your
            recovery score.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle>Recent drinks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {drinks.map((drink) => {
          const units = gramsToUnits(Number(drink.grams_ethanol));
          const when = new Date(drink.drank_at);
          return (
            <div
              key={drink.id}
              className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {drink.quantity > 1 && (
                    <span className="text-muted">{formatQuantity(drink.quantity)} × </span>
                  )}
                  {drink.label}
                </p>
                <p className="text-xs text-muted">
                  {when.toLocaleString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-muted">{units.toFixed(1)}u</span>
                <button
                  type="button"
                  aria-label={`Delete ${drink.label}`}
                  disabled={deleting === drink.id}
                  onClick={() => remove(drink.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}

        <div className="mt-4 border-t border-white/[0.06] pt-4">
          {confirmingErase ? (
            <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/[0.06] p-3">
              <p className="text-sm leading-relaxed">
                This deletes your entire alcohol history — every entry, permanently. It is
                removed, not hidden. Nothing else in your account is affected, and your
                Recovery score carries on without it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" size="sm" onClick={eraseAll} disabled={erasing}>
                  {erasing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Delete everything
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingErase(false)}
                  disabled={erasing}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingErase(true)}
              className="text-xs text-muted underline underline-offset-2 transition-colors hover:text-danger"
            >
              Delete my whole alcohol history
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatQuantity(quantity: number): string {
  return quantity % 1 === 0 ? String(quantity) : quantity.toFixed(1);
}
