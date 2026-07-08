import { loadLogPage } from "@/app/(app)/activities/log-page-loader";

export default function CardioLogPage({
  searchParams,
}: {
  searchParams: Promise<{ repeat?: string }>;
}) {
  return loadLogPage({
    sport: null,
    zoneMode: "cardio",
    enduranceOnly: true,
    showFileImport: true,
    searchParams,
  });
}
