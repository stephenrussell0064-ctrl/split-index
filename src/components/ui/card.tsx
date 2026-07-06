import { cn } from "@/lib/utils/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: "accent" | "endurance" | "strength" | "none";
  padding?: "sm" | "md" | "lg";
  interactive?: boolean;
}

export function Card({
  className,
  glow = "none",
  padding = "md",
  interactive = false,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "glass rounded-2xl border border-white/[0.05] transition-colors duration-200 hover:border-white/[0.08]",
        padding === "sm" && "p-5",
        padding === "md" && "p-5 md:p-6",
        padding === "lg" && "p-6 md:p-8",
        glow === "accent" && "glow-accent",
        glow === "endurance" && "glow-endurance",
        glow === "strength" && "glow-strength",
        interactive && "card-interactive cursor-default",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.12em] text-muted",
        className
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props} />;
}
