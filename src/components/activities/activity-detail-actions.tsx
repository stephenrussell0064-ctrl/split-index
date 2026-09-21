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
      {/*
        The word "Delete", not a bare bin icon.
        
        This button held a `<Trash2 />` and nothing else — no text, and no
        aria-label either, so it had no accessible name at all. On the screen
        it reads as an empty red rectangle sitting beside a labelled "Edit",
        which is exactly how it was reported: "two buttons, one says delete
        activity and the other one has no text". A screen reader announced it
        as "button".

        Labelling it is also the safer of the two fixes available. An unlabelled
        control next to a labelled one invites the guess that it is the same
        kind of thing, and the guess is wrong in the one direction that cannot
        be undone.
      */}
      <Button
        variant="ghost"
        size="sm"
        className="text-danger hover:text-danger hover:bg-danger/10"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
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
