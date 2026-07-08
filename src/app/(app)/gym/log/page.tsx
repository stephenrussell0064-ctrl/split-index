import { loadLogPage } from "@/app/(app)/activities/log-page-loader";

export default function GymLogPage({
  searchParams,
}: {
  searchParams: Promise<{ repeat?: string; plan?: string; template?: string }>;
}) {
  return loadLogPage({
    sport: "gym",
    zoneMode: "gym",
    searchParams,
  });
}
