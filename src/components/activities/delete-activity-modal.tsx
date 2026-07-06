"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

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

  if (!open) return null;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      onDeleted?.();
      router.push("/activities");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
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
