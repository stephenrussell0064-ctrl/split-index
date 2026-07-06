import {
  Zap,
  TrendingUp,
  Crown,
  Flame,
  Scale,
  Trophy,
  Medal,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  zap: Zap,
  "trending-up": TrendingUp,
  crown: Crown,
  flame: Flame,
  scale: Scale,
  trophy: Trophy,
};

export function AchievementIcon({
  slug,
  icon,
  earned,
  size = "md",
}: {
  slug: string;
  icon: string;
  earned: boolean;
  size?: "sm" | "md";
}) {
  const Icon = ICON_MAP[icon] ?? Medal;
  const sizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <Icon
      className={`${sizeClass} ${earned ? "text-warning" : "text-muted/40"}`}
      aria-label={slug}
    />
  );
}
