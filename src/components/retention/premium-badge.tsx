import { Crown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function PremiumBadge({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 font-medium text-warning",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        className
      )}
    >
      <Crown className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Premium
    </span>
  );
}
