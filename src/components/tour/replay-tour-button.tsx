"use client";

import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startTour } from "@/lib/tour/tour-state";

/** "Show me around again" — the Help page's way back into the tab-bar tour. */
export function ReplayTourButton() {
  return (
    <Button variant="secondary" size="sm" className="gap-2" onClick={() => startTour()}>
      <Compass className="h-4 w-4" aria-hidden />
      Show me around
    </Button>
  );
}
