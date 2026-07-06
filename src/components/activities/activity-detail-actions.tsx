"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteActivityModal } from "@/components/activities/delete-activity-modal";

export function ActivityDetailActions({
  activityId,
  activityTitle,
}: {
  activityId: string;
  activityTitle: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-danger hover:text-danger hover:bg-danger/10"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <DeleteActivityModal
        activityId={activityId}
        activityTitle={activityTitle}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
