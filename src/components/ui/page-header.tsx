import { cn } from "@/lib/utils/cn";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  className,
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
        <h1 className="text-xl font-semibold tracking-tight md:text-3xl">
          {title}
        </h1>
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
