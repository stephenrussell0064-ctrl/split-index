"use client";

import { useSetModeOverride } from "@/components/layout/mode-override-context";

/**
 * Themes the shell for pages whose pathname can't encode a mode but whose
 * mode IS known up front (server-side), unlike the generic log/edit forms
 * this same override mechanism was built for. /activities/[id] never
 * registered an override at all, so it fell back to the dark "neutral"
 * default even for cardio activities (user-reported: clicking into a
 * logged cardio session opened a dark screen instead of light).
 */
export function SetActivityMode({ zone }: { zone: "gym" | "cardio" }) {
  useSetModeOverride(zone);
  return null;
}
