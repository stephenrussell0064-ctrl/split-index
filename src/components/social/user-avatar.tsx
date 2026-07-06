import { cn } from "@/lib/utils/cn";

const COLORS = [
  "from-accent/30 to-accent/10",
  "from-endurance/30 to-endurance/10",
  "from-strength/30 to-strength/10",
  "from-warning/30 to-warning/10",
];

export function UserAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const sizeClass =
    size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-14 w-14 text-base" : "h-10 w-10 text-xs";

  const colorIdx = name.charCodeAt(0) % COLORS.length;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn("rounded-full object-cover ring-1 ring-white/10", sizeClass, className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br font-semibold ring-1 ring-white/10",
        COLORS[colorIdx],
        sizeClass,
        className
      )}
    >
      {initials}
    </div>
  );
}
