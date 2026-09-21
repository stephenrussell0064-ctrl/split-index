"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Share2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useDialog } from "@/components/ui/use-dialog";

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
  /** What the card contains, in the athlete's words, shown above the preview. */
  contentSummary: string;
}

/**
 * Share a generated report card — after showing the athlete exactly what it says.
 *
 * WHY THERE IS A CONFIRMATION STEP (M10)
 * --------------------------------------
 * This used to fetch the PNG and hand it straight to the OS share sheet. D4
 * requires sharing to be opt-in PER SHARE, with the exact content shown first,
 * and it says so because of what this product holds: a card built to be posted
 * publicly, carrying a real number about a named person's training.
 *
 * "The OS share sheet shows a thumbnail" is not that. It appears after the
 * decision, it is the size of a stamp, and on the desktop fallback there was no
 * preview at all — the image simply opened in a new tab, which is disclosure
 * rather than consent. The Hybrid report was worse still: a bare
 * `<a href="/api/reports/hybrid/card" target="_blank">`, so the first time the
 * athlete saw the card was after it had been generated and opened.
 *
 * Now: fetch, render the actual PNG at a readable size with a plain-English
 * line saying what is on it, and share nothing until the athlete presses Share
 * in that dialog. Cancel discards the blob.
 *
 * A side benefit worth naming, because it looks like a risk: `navigator.share`
 * requires transient activation, and the old code awaited a `fetch` before
 * calling it — spending the click's activation on the network. The confirm
 * press is a fresh gesture, so the share call is now MORE reliable, not less.
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
  contentSummary,
}: ShareImageButtonProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Object URLs are not garbage collected; a card previewed and cancelled a few
  // times would otherwise hold every blob for the life of the page.
  const urlRef = useRef<string | null>(null);
  const release = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);
  useEffect(() => release, [release]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        setError("Couldn't build your card. Please try again.");
        return;
      }
      const blob = await res.blob();
      release();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPreview({ url, blob });
    } catch {
      setError("Couldn't build your card. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function closePreview() {
    setPreview(null);
    release();
  }

  async function handleConfirmShare() {
    if (!preview) return;
    const file = new File([preview.blob], filename, {
      type: preview.blob.type || "image/png",
    });

    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
    };

    try {
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: shareTitle, text: shareText });
      } else {
        // Desktop, or a browser without file sharing. Downloading is the
        // athlete's own copy — it goes nowhere until they send it.
        const a = document.createElement("a");
        a.href = preview.url;
        a.download = filename;
        a.click();
      }
      closePreview();
    } catch (err) {
      // AbortError just means the share sheet was dismissed. The athlete
      // changed their mind, which is the whole point of this dialog existing.
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Couldn't open the share sheet. Your card is still here.");
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        loading={loading}
        onClick={handleGenerate}
      >
        <Share2 className="h-3.5 w-3.5" />
        {label}
      </Button>

      {error && !preview && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {preview && (
        <SharePreviewDialog
          url={preview.url}
          contentSummary={contentSummary}
          error={error}
          onCancel={closePreview}
          onConfirm={handleConfirmShare}
        />
      )}
    </>
  );
}

function SharePreviewDialog({
  url,
  contentSummary,
  error,
  onCancel,
  onConfirm,
}: {
  url: string;
  contentSummary: string;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { dialogRef, dialogProps } = useDialog(onCancel, {
    label: "Check your card before sharing",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={dialogRef}
        {...dialogProps}
        className="w-full max-w-lg rounded-2xl glass border border-white/10 p-5"
      >
        <h2 className="text-base font-semibold">Check your card before sharing</h2>
        <p className="mt-1 text-xs text-muted">{contentSummary}</p>

        {/*
          The actual generated PNG, not a mock-up of it. "The exact content
          shown first" means the bytes that will be shared, or the preview is
          just a different thing to disagree with later.

          `unoptimized` because this is a blob: URL for an image that exists
          only in this tab — there is nothing for the optimiser to fetch.
        */}
        <Image
          src={url}
          alt="Your report card, exactly as it will be shared"
          width={1200}
          height={630}
          unoptimized
          className="mt-3 w-full rounded-lg border border-white/10"
        />

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onConfirm}>
            <Share2 className="h-3.5 w-3.5" />
            Share this card
          </Button>
        </div>
      </div>
    </div>
  );
}
