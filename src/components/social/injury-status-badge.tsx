import { Bandage } from "lucide-react";
import {
  injuryStatusLabel,
  injuryStatusShortLabel,
  type InjuryStatus,
} from "@/lib/social/injury-status";
import { cn } from "@/lib/utils/cn";

/**
 * The one place an injury status is drawn, so it reads identically wherever it
 * appears and can only ever say the two things it is allowed to say.
 *
 * Deliberately plain: a muted chip, not a warning colour. This is context for
 * a friend reading a quiet week, not an alert — and an athlete is much less
 * likely to leave a status switched on if the app renders it as a klaxon every
 * time they open the page.
 *
 * Not a client component. It has no state and no handlers, so it renders on
 * the server inside `/profile` and still composes into the client-side social
 * panels that import it.
 */
export function InjuryStatusBadge({
  status,
  compact = false,
  className,
}: {
  status: InjuryStatus;
  /** Short label for tight rows (a friends-list line). Same meaning, fewer characters. */
  compact?: boolean;
  className?: string;
}) {
  const label = compact ? injuryStatusShortLabel(status) : injuryStatusLabel(status);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-muted",
        className
      )}
    >
      <Bandage className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
