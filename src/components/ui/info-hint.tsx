"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CircleHelp, X } from "lucide-react";
import { useDialog } from "@/components/ui/use-dialog";
import { cn } from "@/lib/utils/cn";

/**
 * A small "?" beside a label that explains, in a sentence or two, what the
 * thing next to it is.
 *
 * User feedback: the app is hard to use because nothing says what anything
 * means. Scores, indexes and section names were shown with no explanation
 * closer than a public methodology page. This puts the explanation one tap
 * from the number, in the words a person who has never opened the app would
 * need.
 *
 * It opens a sheet rather than a hover tooltip: there is no hover on a phone,
 * and the sheet is the shape the app already uses to explain a score (see
 * personal-score-explainer.tsx), so it behaves the same way — focus moves into
 * it, Tab stays inside it, Escape closes it, and focus goes back to the "?".
 *
 * Every sheet ends with a link into the in-app guide, so a one-line answer is
 * never the only answer.
 */
export function InfoHint({
  label,
  title,
  learnMoreHref = "/help#scores",
  children,
  className,
}: {
  /** What is being explained, as it is labelled on screen. Used for the button's name: "What is Split Index?" */
  label: string;
  /** The heading inside the sheet. Defaults to the label. */
  title?: string;
  /** Where "Read more in the guide" goes. */
  learnMoreHref?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        44×44 hit area around a 16px glyph. The negative margin means it takes
        up no more room in the layout than the glyph does, so it can sit inside
        a label without pushing it about — the same trick the top bar's back
        button uses.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`What is ${label}?`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "-m-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full align-middle text-muted transition-colors hover:bg-white/5 hover:text-foreground",
          className
        )}
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <ExplainerSheet
            title={title ?? label}
            learnMoreHref={learnMoreHref}
            onClose={() => setOpen(false)}
          >
            {children}
          </ExplainerSheet>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Its own component so `useDialog` mounts with the sheet and unmounts with it —
 * the focus work has to happen on open, and a hook cannot live inside the
 * `{open && …}` that guards it.
 */
function ExplainerSheet({
  title,
  learnMoreHref,
  onClose,
  children,
}: {
  title: string;
  learnMoreHref: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { dialogRef, dialogProps } = useDialog(onClose, { label: title });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        {...dialogProps}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        className="glass-strong w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold leading-snug">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close explanation"
            className="-m-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-muted">{children}</div>
        <Link
          href={learnMoreHref}
          className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Read more in the guide →
        </Link>
      </motion.div>
    </motion.div>
  );
}
