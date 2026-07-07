import { cn } from "@/lib/utils/cn";

export function ScoreDisclaimer({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "compact";
}) {
  const text =
    variant === "compact"
      ? "Scores are estimates for training insight only — not medical advice."
      : "Split Index scores are training estimates based on your logged data. They are not medical advice, diagnoses, or professional coaching. Consult a qualified professional before changing your training or health routine.";

  return (
    <p
      className={cn(
        "text-muted leading-relaxed",
        variant === "compact" ? "text-[10px]" : "text-xs",
        className
      )}
      role="note"
    >
      {text}
    </p>
  );
}
