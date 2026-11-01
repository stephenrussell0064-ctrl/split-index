/**
 * Cable/machine attachment picker (user feedback: "equipment/attachment
 * picker for exercises (e.g. tricep pushdown rope vs straight bar) with
 * images/descriptions, and predictions differing per attachment").
 *
 * Scoped to the small set of cable exercises where the attachment
 * genuinely changes how much weight the same true effort can move — a
 * straight bar locks the wrist and lets you move noticeably more weight
 * than a rope for the same triceps effort, so scoring both attachments
 * identically at the same logged weight would silently reward switching
 * to the "easier" attachment. Each attachment carries an `anchorMultiplier`
 * applied to the exercise's calibrated anchor ratio in scoreStrength()
 * (split-strength-engine.ts) — >1 for attachments that let you move more
 * weight for equivalent effort (so the same kg scores a little lower),
 * <1 for attachments that let you move less (so the same kg scores a
 * little higher). The baseline/most common attachment for each exercise
 * is always 1.0 — no adjustment, matching how the exercise was originally
 * calibrated.
 *
 * ## Equipment is the exercise's, not the anchor's (1 Nov 2026)
 *
 * Options used to be looked up by anchor key alone, and several dumbbell
 * and barbell movements share a cable anchor for SCORING: "Overhead Tricep
 * Extension", "Dumbbell Kickback" and "JM Press" all scored on
 * tricepPushdown, so all three offered a rope / straight bar / V-bar. The
 * owner's words: "there is no dumbbell attachment but only rope but surely
 * this would just be for cable overhead tricep extension and this needs to
 * be checked for all exercises". The lookup is now by exercise NAME first
 * (ATTACHMENT_SET_BY_EXERCISE_NAME), then by anchor key, and a name can
 * opt out with `null`. Every catalogue exercise that lands on an
 * attachment-bearing key was checked; the opt-outs are listed with why.
 *
 * ## Single arm vs two arms
 *
 * The same request: "the option should be available for single arm or two
 * arms for these kind of exercises". That is a second, independent choice —
 * rope AND one arm — so it is a second picker (getArmModeOptions), not
 * three more chips in the first. Both choices travel in the one
 * `gym_exercises.attachment` column as "<attachment>|<arm mode>" (see
 * encodeAttachmentValue), so no migration and no new column; a value with
 * no "|" is exactly what it always was.
 *
 * "Images": no photo library exists for this app and sourcing real
 * equipment photography raises licensing questions this file shouldn't
 * decide unilaterally — each attachment instead gets a distinct Lucide
 * icon (a real visual cue, not just text) plus a plain-language
 * description. Swap `icon` for a real photo/illustration asset later
 * without changing the data shape or the scoring logic.
 */
import type { ExerciseAttachmentIcon } from "./attachment-icons";

// Deliberately does NOT import from split-strength-engine.ts (resolveAnchorKey
// lives there) — that file imports resolveAttachmentMultiplier from here to
// apply it during scoring, so importing back would be circular. Callers
// (scoreStrength() itself, and UI code) resolve the exercise name to its
// anchor key first via resolveAnchorKey(), then pass that key in here.

export interface ExerciseAttachment {
  id: string;
  label: string;
  description: string;
  icon: ExerciseAttachmentIcon;
  /** Applied to the exercise's anchorRatio before scoring. 1.0 = this exercise's original calibration (no change). */
  anchorMultiplier: number;
}

/** Same lower-case/trim rule as the engine's normalizeName — kept local to avoid the circular import above. */
function normalizeExerciseName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Keyed by the exercise's resolved anchor key (same identifier
 * scoreStrength() resolves free-text names to — see resolveAnchorKey), or
 * by a set name that ATTACHMENT_SET_BY_EXERCISE_NAME points at.
 */
export const EXERCISE_ATTACHMENTS: Record<string, ExerciseAttachment[]> = {
  tricepPushdown: [
    {
      id: "rope",
      label: "Rope",
      description: "Full wrist rotation and range of motion — the most common, most demanding option.",
      icon: "rope",
      anchorMultiplier: 1.0,
    },
    {
      id: "straight-bar",
      label: "Straight bar",
      description: "Locked wrist position lets you move more weight for the same triceps effort.",
      icon: "straight-bar",
      anchorMultiplier: 1.12,
    },
    {
      id: "v-bar",
      label: "V-bar",
      description: "Neutral grip, shorter range of motion — between rope and straight bar.",
      icon: "v-bar",
      anchorMultiplier: 1.06,
    },
  ],
  /**
   * Overhead tricep extension — EQUIPMENT, not attachment, because the
   * movement is done with a dumbbell, an EZ bar or a cable and the loads are
   * nothing alike. Scored on its own anchor (overheadTricepExtension, a
   * single dumbbell held in both hands, Strength Level's "Dumbbell Tricep
   * Extension" standards), so the dumbbell is the 1.0 baseline. The other
   * multipliers are the ratio of Strength Level's intermediate standard for
   * that equipment to the dumbbell's (22 kg at 80 kg bodyweight): barbell
   * "Tricep Extension" 46 kg -> 2.1; cable overhead extension taken as the
   * same as the bar — the stack moves about what a bar does — with the
   * rope/bar split borrowed from the pushdown (bar 1.12x rope).
   */
  overheadTricepExtension: [
    {
      id: "dumbbell",
      label: "Dumbbell",
      description: "One dumbbell held in both hands behind the head — what the standards for this exercise assume.",
      icon: "dumbbell",
      anchorMultiplier: 1.0,
    },
    {
      id: "ez-bar",
      label: "EZ bar / barbell",
      description: "A bar overhead moves roughly double what a single dumbbell does for the same triceps effort.",
      icon: "straight-bar",
      anchorMultiplier: 2.1,
    },
    {
      id: "cable-rope",
      label: "Cable rope",
      description: "Rope from a low pulley, overhead. Constant tension; loads sit near the bar's.",
      icon: "rope",
      anchorMultiplier: 1.9,
    },
    {
      id: "cable-bar",
      label: "Cable bar",
      description: "Straight or EZ bar on the cable. Locked wrists move a little more than the rope.",
      icon: "straight-bar",
      anchorMultiplier: 2.1,
    },
  ],
  latPulldown: [
    {
      id: "wide-bar",
      label: "Wide bar",
      description: "Wide overhand grip — the standard lat pulldown attachment.",
      icon: "wide-bar",
      anchorMultiplier: 1.0,
    },
    {
      id: "close-v-bar",
      label: "Close-grip V-bar",
      description: "Shorter, mechanically-advantaged pull that typically moves more weight.",
      icon: "v-bar",
      anchorMultiplier: 1.1,
    },
    {
      id: "single-handle",
      label: "Single handle",
      description: "One arm at a time — more stabilization demand, noticeably less weight per side.",
      icon: "single-handle",
      anchorMultiplier: 0.75,
    },
  ],
  /**
   * Cable row. This set lived on dbRow until 1 Nov 2026, when the seated
   * cable row got its own anchor (seatedCableRow) and the dumbbell row, which
   * has no cable and no attachment, stopped offering a V-bar.
   */
  seatedCableRow: [
    {
      id: "v-bar",
      label: "V-bar",
      description: "Neutral, close grip — the standard cable row attachment.",
      icon: "v-bar",
      anchorMultiplier: 1.0,
    },
    {
      id: "wide-bar",
      label: "Wide bar / rope",
      description: "Wider pull, more rear-delt and upper-back involvement, typically less weight.",
      icon: "rope",
      anchorMultiplier: 0.92,
    },
    {
      id: "single-handle",
      label: "Single handle",
      description: "One arm at a time — more core/stabilization demand, less weight per side.",
      icon: "single-handle",
      anchorMultiplier: 0.65,
    },
  ],
  /**
   * LEG PRESS — machine type, not an attachment, and the largest adjustment in
   * this file by a wide margin. It is here rather than in a parallel mechanism
   * because the question is identical ("same logged kg, different equipment,
   * different true effort") and this one already reaches the scorer through
   * `gym_exercises.attachment`. No new column, no migration.
   *
   * ## Why leg press needs it more than any other lift
   *
   * The anchors (`legPress: slTable([109, 162, 230, 309, 395])`) are Strength
   * Level's, and that data is overwhelmingly 45-degree plate-loaded sleds
   * logged as PLATE load. On such a sled the force along the rail is only
   * `W x sin(45) = 0.707W` — so a horizontal machine at 163 kg and an angled
   * sled at 230 kg are the same effort, and 163/230 is 0.71. The multiplier
   * below is that geometry and nothing more.
   *
   * Without this, the two are scored identically and a seated stack machine
   * reads as roughly a third weaker than the athlete is. That is not a
   * hypothetical: it is why one real session's leg press scored 313 against a
   * squat from the same session at 582, when a leg press is normally 1.5-2x
   * a squat.
   *
   * ## What is NOT modelled, deliberately
   *
   * The carriage. A 45-degree sled's empty carriage runs anywhere from 20 kg
   * to 90 kg depending on the model, and nothing the athlete can see tells
   * them which. Strength Level's numbers already absorb a typical carriage,
   * so the baseline stays "count your plates" — the answer most people can
   * actually give. An athlete on a machine that displays total load including
   * the carriage will read slightly strong, and that is the smaller error.
   *
   * Lever-arm machines are the other known gap: a seated press with a linkage
   * has its own mechanical advantage that the stack number does not reveal,
   * so `horizontal` is an approximation there rather than the clean geometry
   * it is for a true horizontal slide.
   */
  legPress: [
    {
      id: "sled-45",
      label: "45° sled",
      description:
        "The angled plate-loaded sled most gyms have. Count the plates you loaded — this is what the standards assume.",
      icon: "sled-45",
      anchorMultiplier: 1.0,
    },
    {
      id: "horizontal",
      label: "Seated / horizontal",
      description:
        "Weight stack, load pushed straight back. There is no incline helping you, so the same effort moves about 30% less than on an angled sled.",
      icon: "horizontal-press",
      anchorMultiplier: 0.71,
    },
    {
      id: "vertical",
      label: "Vertical",
      description:
        "Pressing straight up against the full load. Hardest per kilo of the three, and the rarest.",
      icon: "vertical-press",
      anchorMultiplier: 0.68,
    },
  ],
  cableCurl: [
    {
      id: "straight-bar",
      label: "Straight bar",
      description: "The standard cable curl attachment.",
      icon: "straight-bar",
      anchorMultiplier: 1.0,
    },
    {
      id: "ez-bar",
      label: "EZ bar",
      description: "Angled grip, easier on the wrists, comparable load to a straight bar.",
      icon: "v-bar",
      anchorMultiplier: 0.95,
    },
    {
      id: "rope",
      label: "Rope",
      description: "Hammer-style neutral grip with a squeeze at the top — noticeably less weight.",
      icon: "rope",
      anchorMultiplier: 0.85,
    },
  ],
};

/**
 * Exercise name -> attachment set, checked BEFORE the anchor key. `null`
 * means "this exercise has no attachment, whatever it scores on". Every
 * catalogue name that resolves to a key in EXERCISE_ATTACHMENTS was walked
 * (the engine's resolveAnchorKey over COMMON_EXERCISES); these are the ones
 * where the key's equipment is not the exercise's.
 */
const ATTACHMENT_SET_BY_EXERCISE_NAME: Record<string, string | null> = {
  // Scores on tricepPushdown's curve (or its own) but is not a cable.
  "dumbbell kickback": null,
  "jm press": null,
  "tricep extension": "overheadTricepExtension",
  "overhead tricep extension": "overheadTricepExtension",
  // The cable version of the same movement: same equipment set, the cable
  // rope is the default (see DEFAULT_ATTACHMENT_BY_EXERCISE_NAME).
  "cable overhead extension": "overheadTricepExtension",
  "overhead cable extension": "overheadTricepExtension",
  // Rows that score on a cable row's curve without a cable: a face pull is a
  // rope by definition (one option is no choice), an inverted row is a bar,
  // a machine row is whatever handles the machine has.
  "face pull": null,
  "inverted row": null,
  "machine row": null,
};

/**
 * What an exercise means when no attachment was chosen, where that is not
 * the set's 1.0 baseline. "Single Arm Cable Row" IS the single handle; the
 * cable overhead extension IS the rope. Returned by defaultAttachmentValue
 * so the picker shows the right chip selected and the scorer applies the
 * right multiplier to a row the athlete never touched.
 */
const DEFAULT_ATTACHMENT_BY_EXERCISE_NAME: Record<string, string> = {
  "single arm cable row": "single-handle",
  "cable overhead extension": "cable-rope",
  "overhead cable extension": "cable-rope",
  // Encoded as encodeAttachmentValue(null, "single") would write it.
  "single leg extension": "|single",
  "single leg press": "|single",
};

/** The attachment set an exercise uses: by name first, then by resolved anchor key. */
function attachmentSetKey(exerciseName: string | null | undefined, resolvedKey: string): string | null {
  if (exerciseName) {
    const byName = ATTACHMENT_SET_BY_EXERCISE_NAME[normalizeExerciseName(exerciseName)];
    if (byName !== undefined) return byName;
  }
  return EXERCISE_ATTACHMENTS[resolvedKey] ? resolvedKey : null;
}

/**
 * Attachment options for an exercise, or null if it has no attachment
 * variants. Pass the exercise name as logged whenever you have it — the
 * name decides before the anchor key does (see the file comment).
 */
export function getAttachmentOptions(
  exerciseName: string | null | undefined,
  resolvedKey: string
): ExerciseAttachment[] | null {
  const setKey = attachmentSetKey(exerciseName, resolvedKey);
  return setKey ? (EXERCISE_ATTACHMENTS[setKey] ?? null) : null;
}

/** Options by anchor key alone — for callers that have no exercise name. */
export function getAttachmentOptionsByKey(resolvedKey: string): ExerciseAttachment[] | null {
  return getAttachmentOptions(null, resolvedKey);
}

/** The encoded attachment value an exercise means when none was chosen, or null when that is simply the baseline. */
export function defaultAttachmentValue(exerciseName: string | null | undefined): string | null {
  if (!exerciseName) return null;
  return DEFAULT_ATTACHMENT_BY_EXERCISE_NAME[normalizeExerciseName(exerciseName)] ?? null;
}

/**
 * What to call the picker for this exercise. "Attachment" is right for a cable
 * and wrong for a leg press — nobody calls a 45-degree sled an attachment, and
 * a picker labelled with the wrong noun is a picker people skip.
 *
 * A lookup with a default rather than a field on every option: the label
 * belongs to the exercise, not to each choice, and putting it on the options
 * would mean three copies of the same string that can disagree.
 */
const PICKER_LABELS: Record<string, string> = {
  legPress: "Machine",
  overheadTricepExtension: "Equipment",
};

export function getAttachmentPickerLabel(
  resolvedKey: string,
  exerciseName?: string | null
): string {
  const setKey = attachmentSetKey(exerciseName, resolvedKey) ?? resolvedKey;
  return PICKER_LABELS[setKey] ?? "Attachment";
}

// ---------------------------------------------------------------------------
// Single arm / single leg
// ---------------------------------------------------------------------------

export type ArmMode = "both" | "single";

/**
 * One arm moves about 55% of what two move on the same cable — the ratio
 * between this engine's two-arm and single-arm pushdown tables
 * (tricepPushdownSingleArm is "55% of the two-arm standard"), and close to
 * Strength Level's single- vs two-leg extension gap. Applied to the anchor
 * like an attachment: the same kg on one arm scores what ~1.8x that kg
 * would on two.
 */
export const SINGLE_LIMB_MULTIPLIER = 0.55;

/**
 * Which exercises offer the choice, and what to call it. Keyed by anchor key
 * or attachment-set name. Exercises whose attachment set already has a
 * single-handle chip (lat pulldown, cable row) are NOT here — one way to say
 * "one arm", not two that can disagree. Dumbbell movements logged per hand
 * (curls, lateral raises) are not here either: the per-hand load is already
 * the one-arm load, and the standards are already per dumbbell.
 */
const ARM_MODE_EXERCISES: Record<string, { label: string; both: string; single: string }> = {
  tricepPushdown: { label: "Arms", both: "Both arms", single: "Single arm" },
  overheadTricepExtension: { label: "Arms", both: "Both arms", single: "Single arm" },
  cableCurl: { label: "Arms", both: "Both arms", single: "Single arm" },
  cableFly: { label: "Arms", both: "Both arms", single: "Single arm" },
  legExtension: { label: "Legs", both: "Both legs", single: "Single leg" },
  legCurl: { label: "Legs", both: "Both legs", single: "Single leg" },
  legPress: { label: "Legs", both: "Both legs", single: "Single leg" },
  calfRaise: { label: "Legs", both: "Both legs", single: "Single leg" },
};

export interface ArmModeOptions {
  label: string;
  options: ExerciseAttachment[];
}

/** The single-vs-both picker for an exercise, or null when the choice does not apply. */
export function getArmModeOptions(
  exerciseName: string | null | undefined,
  resolvedKey: string
): ArmModeOptions | null {
  const setKey = attachmentSetKey(exerciseName, resolvedKey);
  const config = (setKey && ARM_MODE_EXERCISES[setKey]) || ARM_MODE_EXERCISES[resolvedKey];
  if (!config) return null;
  return {
    label: config.label,
    options: [
      {
        id: "both",
        label: config.both,
        description: "Both sides together — the load the standards are written for.",
        icon: "both-limbs",
        anchorMultiplier: 1.0,
      },
      {
        id: "single",
        label: config.single,
        description:
          "One side at a time. Enter the weight that one side moved; it is scored against roughly half the two-sided standard.",
        icon: "single-limb",
        anchorMultiplier: SINGLE_LIMB_MULTIPLIER,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The stored value
// ---------------------------------------------------------------------------

const ARM_MODE_SEPARATOR = "|";

export interface ParsedAttachmentValue {
  attachment: string | null;
  armMode: ArmMode | null;
}

/**
 * "rope" -> { rope, null }; "rope|single" -> { rope, single }; "|single" ->
 * { null, single }. Anything not understood reads as nothing, the same way an
 * unknown attachment id always has.
 */
export function parseAttachmentValue(value: string | null | undefined): ParsedAttachmentValue {
  if (!value) return { attachment: null, armMode: null };
  const [attachmentPart, armPart] = value.split(ARM_MODE_SEPARATOR);
  const attachment = attachmentPart ? attachmentPart : null;
  const armMode: ArmMode | null = armPart === "single" ? "single" : armPart === "both" ? "both" : null;
  return { attachment, armMode };
}

/** The inverse of parseAttachmentValue. A plain attachment with no arm mode encodes exactly as it always did. */
export function encodeAttachmentValue(attachment: string | null, armMode: ArmMode | null): string | null {
  if (!attachment && !armMode) return null;
  if (!armMode) return attachment;
  return `${attachment ?? ""}${ARM_MODE_SEPARATOR}${armMode}`;
}

/**
 * The multiplier for an exercise's stored attachment value — attachment and
 * arm mode combined — or 1.0 (no adjustment) if nothing is recognised. Pass
 * the exercise name when you have it, for the same reason as
 * getAttachmentOptions.
 *
 * `weightScaled` is true when the caller has already doubled a per-hand load
 * to a two-sided total (weight-entry.ts, a `per_hand` entry on a total-load
 * anchor). One arm's load doubled is two arms' worth, so a single-arm set
 * logged that way wants 2 x SINGLE_LIMB_MULTIPLIER, not the multiplier alone.
 */
export function resolveAttachmentMultiplierByKey(
  resolvedKey: string,
  value: string | null | undefined,
  exerciseName?: string | null,
  weightScaled = false
): number {
  const { attachment, armMode } = parseAttachmentValue(value ?? defaultAttachmentValue(exerciseName));
  let multiplier = 1.0;
  if (attachment) {
    const options = getAttachmentOptions(exerciseName, resolvedKey);
    multiplier *= options?.find((a) => a.id === attachment)?.anchorMultiplier ?? 1.0;
  }
  if (armMode === "single" && getArmModeOptions(exerciseName, resolvedKey)) {
    multiplier *= SINGLE_LIMB_MULTIPLIER * (weightScaled ? 2 : 1);
  }
  return multiplier;
}
