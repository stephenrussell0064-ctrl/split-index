"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useDialog } from "@/components/ui/use-dialog";

export function DeleteActivityModal({
  activityTitle,
  open,
  onClose,
  onDeleted,
  activityId,
}: {
  activityTitle: string;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
  activityId: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape to close, focus trapped inside, focus handed back on close — see
  // useDialog. A confirmation nobody can dismiss from the keyboard is a bad
  // confirmation to put in front of a destructive action.
  const { dialogRef, dialogProps } = useDialog(onClose, { label: "Delete this activity?" });

  if (!open) return null;

  /**
   * Reported from a device as "deleting an entry takes a long time and is also
   * very laggy".
   *
   * The delete itself is one request. What made it feel long was everything
   * queued behind it while the modal sat there spinning: `router.push` fetches
   * the logbook, `router.refresh` then re-fetches the same route on the server
   * to bust the client cache, and `setDeleting(false)` was in a `finally` that
   * only ran after both. So the confirmation stayed on screen, greyed and
   * spinning, through two further network round trips — on a shell that loads
   * every page from `server.url` over the athlete's own connection.
   *
   * The row is gone the moment the API says so. Closing the dialog there means
   * the athlete sees the result at the speed of the delete rather than at the
   * speed of the two navigations behind it, and `(app)/activities/loading.tsx`
   * now covers the trip back with a skeleton instead of a frozen screen.
   *
   * `refresh()` stays, and stays AFTER the push: the logbook is a server
   * component and the client router would otherwise serve a cached payload
   * still listing the activity that was just deleted. Dropping it to save a
   * round trip would trade this bug for a worse one.
   */
  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");

      onDeleted?.();
      setDeleting(false);
      onClose();

      router.push("/activities");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        {...dialogProps}
        className={cn(
          "relative w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a] p-6 shadow-xl",
          "animate-in fade-in slide-in-from-bottom-4 duration-200"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15">
            <AlertTriangle className="h-5 w-5 text-danger" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Delete activity?</h2>
            <p className="mt-1 text-sm text-muted">
              &ldquo;{activityTitle}&rdquo; and its scores will be permanently removed.
              Your Split Index will update on your next logged workout.
            </p>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            loading={deleting}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
