/**
 * V2 scoring engine exports — Claude-validated modules.
 * Coefficient tables in cardio-activity.ts and split-strength-engine.ts are audited; do not simplify.
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
  scoreStrength,
  serializeStrengthResult,
  labIndex,
  ageFactor,
  SEX_FACTORS,
  type ScoreStrengthInput,
  type ScoreStrengthResult,
  type FreeStrengthResult,
  type LoggedSet,
} from "./split-strength-engine";

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
} from "./adapters";

export { scoreActivityWithEngines } from "./activity-scorer";
