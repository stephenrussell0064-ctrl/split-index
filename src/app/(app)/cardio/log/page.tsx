import { loadLogPage } from "@/app/(app)/activities/log-page-loader";

export default function CardioLogPage({
  searchParams,
}: {
  /** `hpeSession=<id>` opens the form filled from a Hybrid Plan endurance prescription. */
  searchParams: Promise<{ hpeSession?: string }>;
}) {
  return loadLogPage({
    sport: null,
    zoneMode: "cardio",
    enduranceOnly: true,
    // The gym page forwarded its params and this one did not, so the plan's
    // "Log this session" link landed on the sport picker with the id dropped.
    searchParams,
  });
}
