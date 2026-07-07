/**
 * V2 scoring engine exports — Claude-validated modules.
 * Coefficient tables in cardio-activity.ts and strength-activity.ts are audited; do not simplify.
 */
export {
  scoreCardioActivity,
  estimateMaxHR,
  vo2maxFromHR,
  vo2FromRunningPace,
  riegelPredictions,
  trimp,
  efficiencyFactor,
  decoupling,
  type CardioInput,
  type CardioResult,
  type CardioType,
  type Sex,
} from "./cardio-activity";

export {
  scoreStrengthActivity,
  estimate1RM,
  dotsScore,
  type Lift,
  type StrengthInput,
  type StrengthResult,
} from "./strength-activity";

export {
  computeIndexes,
  aggregateSideIndex,
  projectIndex,
  type Profile as AthleteIndexProfile,
  type ActivityScore,
  type IndexResult,
} from "./index-engine";

export {
  gateCardioResult,
  gateStrengthResult,
  gateIndexResult,
  isCardioResultLocked,
  isStrengthResultLocked,
  isIndexResultLocked,
} from "./gates";

export {
  deriveAthleteProfile,
  buildActivityScores,
  cardioResultToEnrichment,
  buildCardioInput,
  buildStrengthInput,
} from "./adapters";

export { scoreActivityWithEngines } from "./activity-scorer";
