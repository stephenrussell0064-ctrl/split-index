import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Inline "why this number is what it is" note — one short sentence directly
 * under a score, ending in a deep-link to the relevant /how-scoring-works
 * section. Never premium-gated itself (the explanation is free even when
 * the underlying number is locked), so the accuracy argument is felt in the
 * product rather than left as a footnote on a docs page.
 */
export function ScoringExplainerNote({
  children,
  href = "/how-scoring-works",
  linkText = "How is this scored?",
  className,
}: {
  children: React.ReactNode;
  href?: string;
  linkText?: string;
  className?: string;
}) {
  return (
    <p className={cn("mt-2 text-xs italic text-muted", className)}>
      {children}{" "}
      <Link href={href} className="not-italic underline hover:text-foreground">
        {linkText}
      </Link>
    </p>
  );
}
