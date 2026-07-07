import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] select-none",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/20 hover:shadow-accent/30 hover:-translate-y-px",
        secondary:
          "glass text-foreground hover:bg-white/5 border border-white/10 hover:border-white/15",
        ghost:
          "text-muted hover:text-foreground hover:bg-white/5 active:bg-white/[0.07]",
        outline:
          "border border-white/10 text-foreground hover:bg-white/5 hover:border-white/20",
        destructive:
          "bg-danger text-white hover:bg-danger/90 shadow-lg shadow-danger/20",
        endurance:
          "bg-endurance/15 text-endurance border border-endurance/25 hover:bg-endurance/25 hover:border-endurance/40",
        strength:
          "bg-strength/15 text-strength border border-strength/25 hover:bg-strength/25 hover:border-strength/40",
      },
      size: {
        sm: "h-11 min-h-11 px-4 text-sm",
        md: "h-11 min-h-11 px-6 text-sm",
        lg: "h-13 min-h-[52px] px-8 text-base",
        icon: "h-11 w-11 min-h-11 min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

export { buttonVariants };
