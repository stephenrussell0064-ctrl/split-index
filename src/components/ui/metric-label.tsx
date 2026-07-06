import { cn } from "@/lib/utils/cn";

interface MetricLabelProps extends React.HTMLAttributes<HTMLParagraphElement> {
  as?: "p" | "span";
}

export function MetricLabel({
  className,
  as: Tag = "p",
  children,
  ...props
}: MetricLabelProps) {
  return (
    <Tag
      className={cn(
        "text-[10px] font-medium uppercase tracking-[0.15em] text-muted",
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

interface MetricValueProps extends React.HTMLAttributes<HTMLParagraphElement> {
  size?: "sm" | "md" | "lg" | "hero";
}

export function MetricValue({
  className,
  size = "md",
  children,
  ...props
}: MetricValueProps) {
  return (
    <p
      className={cn(
        "index-display font-semibold tabular-nums tracking-tight",
        size === "sm" && "text-lg",
        size === "md" && "text-2xl",
        size === "lg" && "text-4xl",
        size === "hero" && "text-7xl md:text-8xl font-bold",
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}
