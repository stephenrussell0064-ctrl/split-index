import { loadLogPage } from "@/app/(app)/activities/log-page-loader";

export default function CardioLogPage() {
  return loadLogPage({
    sport: null,
    zoneMode: "cardio",
    enduranceOnly: true,
  });
}
