import { loadLogPage } from "@/app/(app)/activities/log-page-loader";

export default function GymLogPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; template?: string; recommend?: string }>;
}) {
  return loadLogPage({
    sport: "gym",
    zoneMode: "gym",
    searchParams,
  });
}
