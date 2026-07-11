import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

const BRAND_ICON = "/splitindex-icon.svg";
const BRAND_LOGO = "/splitindex-logo.svg";

export function BrandIcon({
  size = 32,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={BRAND_ICON}
      alt=""
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0 select-none", className)}
    />
  );
}

/** Text lockup matching the official logo typography. */
export function BrandWordmark({
  className,
  showTagline = false,
  size = "md",
}: {
  className?: string;
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const titleSize =
    size === "lg" ? "text-[17px]" : size === "sm" ? "text-[13px]" : "text-[15px]";
  const tagSize = size === "lg" ? "text-[9px]" : "text-[8px]";

  return (
    <div className={cn("leading-none", className)}>
      <p
        className={cn(
          "font-sans font-bold uppercase tracking-[0.045em]",
          titleSize
        )}
      >
        <span className="text-[#3DFF6E]">SPLIT</span>
        <span className="mx-[0.32em] font-normal text-white/28">/</span>
        <span className="text-[#3BA6FF]">INDEX</span>
      </p>
      {showTagline && (
        <p
          className={cn(
            "mt-1 font-sans font-medium uppercase tracking-[0.24em] text-white/32",
            tagSize
          )}
        >
          Two worlds · one score
        </p>
      )}
    </div>
  );
}

export function BrandLogoImage({
  height = 32,
  className,
  priority = false,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={BRAND_LOGO}
      alt="Split Index"
      width={960}
      height={240}
      priority={priority}
      className={cn("w-auto shrink-0 select-none", className)}
      style={{ height }}
    />
  );
}

type BrandMarkVariant = "full" | "compact" | "icon";

export function BrandMark({
  variant = "compact",
  href,
  className,
  iconSize = 32,
  logoHeight = 32,
  showTagline = false,
  wordmarkSize = "md",
  priority = false,
}: {
  variant?: BrandMarkVariant;
  href?: string;
  className?: string;
  iconSize?: number;
  logoHeight?: number;
  showTagline?: boolean;
  wordmarkSize?: "sm" | "md" | "lg";
  priority?: boolean;
}) {
  const content =
    variant === "full" ? (
      <BrandLogoImage height={logoHeight} priority={priority} />
    ) : variant === "icon" ? (
      <BrandIcon size={iconSize} priority={priority} />
    ) : (
      <>
        <BrandIcon size={iconSize} priority={priority} />
        <BrandWordmark showTagline={showTagline} size={wordmarkSize} />
      </>
    );

  const shellClass = cn(
    "inline-flex items-center",
    variant === "compact" && "gap-2.5",
    className
  );

  if (href) {
    return (
      <Link href={href} className={shellClass} aria-label="Split Index home">
        {content}
      </Link>
    );
  }

  return <div className={shellClass}>{content}</div>;
}

// Back-compat exports for marketing components
export function BrandLogo({
  size = 30,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return <BrandIcon size={size} className={className} priority={priority} />;
}
