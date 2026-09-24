import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils/cn";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  /**
   * A plain-English explanation of what this page is for, opened from a "?"
   * beside the title. The subtitle is the one-line version; this is the one
   * that can take a paragraph, for the person who has never seen the page
   * before (user feedback: nothing in the app says what anything is).
   */
  help?: React.ReactNode;
  /** Where the explanation's "Read more in the guide" link goes. */
  helpHref?: string;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  className,
  help,
  helpHref,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4",
        className
      )}
    >
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted">
            {eyebrow}
          </p>
        )}
        {/*
          text-xl on phones, unchanged from `md` up. Every page header sits
          directly under the top bar and directly above the content the athlete
          came for, and on the screens where the title repeats the nav label
          they just tapped it is spending the top of the fold to tell them
          where they already know they are.

          Only the SIZE is reduced globally. The audit also proposed hiding the
          subtitle below `sm`, which is wrong for this codebase: several of
          them are the only explanation a screen gives — "Lock your phone.
          Tracking keeps going." and "Background GPS tracking needs the Split
          Index app, not the website." are not decoration. The two that really
          are decoration are removed at their call sites instead.
        */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight md:text-3xl">
            {title}
          </h1>
          {help && (
            <InfoHint label="this page" title={`About ${title}`} learnMoreHref={helpHref}>
              {help}
            </InfoHint>
          )}
        </div>
        {subtitle && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
