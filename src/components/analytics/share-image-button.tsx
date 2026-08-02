"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface ShareImageButtonProps {
  /** URL that returns the generated PNG (an ImageResponse route). */
  href: string;
  filename: string;
  shareTitle: string;
  shareText?: string;
  label?: string;
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}

/**
 * One-tap share for a generated report-card image (SPLITINDEX-NEXT-STAGE-REPORT.md
 * Section D) — fetches the PNG and hands it to the native OS share sheet via
 * the Web Share API (Level 2, file sharing) so mobile users land directly on
 * Instagram/TikTok story or "Save to Photos", the actual share targets this
 * is meant to travel on. Falls back to opening the image in a new tab
 * (desktop, or browsers without file-sharing support) so it's never a dead end.
 */
export function ShareImageButton({
  href,
  filename,
  shareTitle,
  shareText,
  label = "Share",
  className,
  size = "sm",
  variant = "secondary",
}: ShareImageButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleShare() {
    setLoading(true);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type || "image/png" });

      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
      };

      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: shareTitle, text: shareText });
      } else {
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      // AbortError just means the user closed the native share sheet.
      if (!(err instanceof Error) || err.name !== "AbortError") {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} className={className} loading={loading} onClick={handleShare}>
      <Share2 className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
