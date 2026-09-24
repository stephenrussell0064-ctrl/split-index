import type { RecoveryBand } from "@/lib/recovery/score";

/**
 * One colour per recovery band, defined once.
 *
 * The gauge, the breakdown bars and the dashboard card all colour by band, and
 * they are three different files. Anything less than a single exported map
 * ends with an amber arc over a green verdict.
 */
export const BAND_COLORS: Record<RecoveryBand, string> = {
  primed: "#10b981",
  steady: "#84cc16",
  compromised: "#f59e0b",
  depleted: "#ef4444",
};
