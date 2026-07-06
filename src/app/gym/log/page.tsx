import { loadLogPage } from "@/app/activities/log-page-loader";

export default function GymLogPage({
  searchParams,
}: {
  searchParams: Promise<{ repeat?: string }>;
}) {
  return loadLogPage({
    sport: "gym",
    zoneMode: "gym",
    searchParams,
  });
}
