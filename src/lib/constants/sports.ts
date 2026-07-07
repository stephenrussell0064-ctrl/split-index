import type { SportType } from "@/types";

/** Display label for per-sport index scores */
export const SPORT_INDEX_LABELS: Record<SportType, string> = {
  running: "Running Index",
  walking: "Walking Index",
  swimming: "Swimming Index",
  rowing: "Rowing Index",
  bike_erg: "BikeErg Index",
  indoor_cycling: "Indoor Cycling Index",
  ski_erg: "SkiErg Index",
  gym: "Gym Strength Index",
};

export const ENDURANCE_SPORTS: SportType[] = [
  "running",
  "walking",
  "swimming",
  "rowing",
  "bike_erg",
  "indoor_cycling",
  "ski_erg",
];

export const SPORTS: {
  id: SportType;
  name: string;
  icon: string;
  category: "endurance" | "strength";
}[] = [
  { id: "running", name: "Running", icon: "🏃", category: "endurance" },
  { id: "walking", name: "Walking", icon: "🚶", category: "endurance" },
  { id: "swimming", name: "Swimming", icon: "🏊", category: "endurance" },
  { id: "rowing", name: "Rowing", icon: "🚣", category: "endurance" },
  { id: "bike_erg", name: "BikeErg", icon: "🚴", category: "endurance" },
  { id: "indoor_cycling", name: "Indoor Cycling", icon: "🚴", category: "endurance" },
  { id: "ski_erg", name: "SkiErg", icon: "⛷️", category: "endurance" },
  { id: "gym", name: "Gym", icon: "🏋️", category: "strength" },
];

export const SESSION_TYPES = [
  { value: "easy", label: "Easy" },
  { value: "recovery", label: "Recovery" },
  { value: "tempo", label: "Tempo" },
  { value: "threshold", label: "Threshold" },
  { value: "interval", label: "Interval" },
  { value: "race", label: "Race" },
  { value: "long", label: "Long" },
  { value: "other", label: "Other" },
];

export const STROKE_TYPES = [
  { value: "freestyle", label: "Freestyle" },
  { value: "backstroke", label: "Backstroke" },
  { value: "breaststroke", label: "Breaststroke" },
  { value: "butterfly", label: "Butterfly" },
  { value: "mixed", label: "Mixed" },
];

/** Broad categories for exercise picker filtering */
export const MUSCLE_GROUP_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "chest", label: "Chest" },
  { id: "back", label: "Back" },
  { id: "legs", label: "Legs" },
  { id: "shoulders", label: "Shoulders" },
  { id: "arms", label: "Arms" },
  { id: "core", label: "Core" },
] as const;

export type MuscleGroupCategory = (typeof MUSCLE_GROUP_CATEGORIES)[number]["id"];

export const MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Core",
  "Calves",
];

export type ExerciseKind = "compound" | "accessory";

export interface ExerciseDefinition {
  name: string;
  muscle: string;
  category: MuscleGroupCategory;
  kind: ExerciseKind;
}

/** Maps detailed muscle group → filter category */
export function muscleToCategory(muscle: string): MuscleGroupCategory {
  switch (muscle) {
    case "Chest":
      return "chest";
    case "Back":
      return "back";
    case "Shoulders":
      return "shoulders";
    case "Biceps":
    case "Triceps":
      return "arms";
    case "Quads":
    case "Hamstrings":
    case "Glutes":
    case "Calves":
      return "legs";
    case "Core":
      return "core";
    default:
      return "all";
  }
}

export const COMMON_EXERCISES: ExerciseDefinition[] = [
  // Chest — compound
  { name: "Bench Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Incline Bench Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Decline Bench Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Dumbbell Bench Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Incline Dumbbell Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Decline Dumbbell Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Machine Chest Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Smith Machine Bench Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Push Up", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Weighted Push Up", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Chest Dips", muscle: "Chest", category: "chest", kind: "compound" },
  // Chest — accessory
  { name: "Cable Fly", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "Low-to-High Cable Fly", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "High-to-Low Cable Fly", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "Dumbbell Fly", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "Incline Dumbbell Fly", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "Pec Deck", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "Dumbbell Pullover", muscle: "Chest", category: "chest", kind: "accessory" },
  { name: "Svend Press", muscle: "Chest", category: "chest", kind: "accessory" },

  // Back — compound
  { name: "Deadlift", muscle: "Back", category: "back", kind: "compound" },
  { name: "Sumo Deadlift", muscle: "Back", category: "back", kind: "compound" },
  { name: "Trap Bar Deadlift", muscle: "Back", category: "back", kind: "compound" },
  { name: "Rack Pull", muscle: "Back", category: "back", kind: "compound" },
  { name: "Barbell Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Pendlay Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Dumbbell Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Chest Supported Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Seal Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Pull Up", muscle: "Back", category: "back", kind: "compound" },
  { name: "Weighted Pull Up", muscle: "Back", category: "back", kind: "compound" },
  { name: "Chin Up", muscle: "Back", category: "back", kind: "compound" },
  { name: "Weighted Chin Up", muscle: "Back", category: "back", kind: "compound" },
  { name: "Lat Pulldown", muscle: "Back", category: "back", kind: "compound" },
  { name: "Close Grip Lat Pulldown", muscle: "Back", category: "back", kind: "compound" },
  { name: "T-Bar Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Machine Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Meadows Row", muscle: "Back", category: "back", kind: "compound" },
  // Back — accessory
  { name: "Seated Cable Row", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Single Arm Cable Row", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Face Pull", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Straight Arm Pulldown", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Inverted Row", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Back Extension", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Good Morning", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Shrug", muscle: "Back", category: "back", kind: "accessory" },
  { name: "Dumbbell Shrug", muscle: "Back", category: "back", kind: "accessory" },

  // Legs — compound
  { name: "Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Front Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Box Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Pause Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Goblet Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Smith Machine Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Leg Press", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Single Leg Press", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Hack Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Pendulum Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Romanian Deadlift", muscle: "Hamstrings", category: "legs", kind: "compound" },
  { name: "Stiff Leg Deadlift", muscle: "Hamstrings", category: "legs", kind: "compound" },
  { name: "Single Leg RDL", muscle: "Hamstrings", category: "legs", kind: "compound" },
  { name: "Hip Thrust", muscle: "Glutes", category: "legs", kind: "compound" },
  { name: "Barbell Glute Bridge", muscle: "Glutes", category: "legs", kind: "compound" },
  { name: "Lunges", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Walking Lunges", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Reverse Lunges", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Bulgarian Split Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Step Up", muscle: "Quads", category: "legs", kind: "compound" },
  // Legs — accessory
  { name: "Leg Extension", muscle: "Quads", category: "legs", kind: "accessory" },
  { name: "Single Leg Extension", muscle: "Quads", category: "legs", kind: "accessory" },
  { name: "Leg Curl", muscle: "Hamstrings", category: "legs", kind: "accessory" },
  { name: "Seated Leg Curl", muscle: "Hamstrings", category: "legs", kind: "accessory" },
  { name: "Nordic Curl", muscle: "Hamstrings", category: "legs", kind: "accessory" },
  { name: "Glute Kickback", muscle: "Glutes", category: "legs", kind: "accessory" },
  { name: "Hip Abduction", muscle: "Glutes", category: "legs", kind: "accessory" },
  { name: "Hip Adduction", muscle: "Glutes", category: "legs", kind: "accessory" },
  { name: "Cable Pull Through", muscle: "Glutes", category: "legs", kind: "accessory" },
  { name: "Calf Raise", muscle: "Calves", category: "legs", kind: "accessory" },
  { name: "Seated Calf Raise", muscle: "Calves", category: "legs", kind: "accessory" },
  { name: "Standing Calf Raise", muscle: "Calves", category: "legs", kind: "accessory" },
  { name: "Leg Press Calf Raise", muscle: "Calves", category: "legs", kind: "accessory" },
  { name: "Tibialis Raise", muscle: "Calves", category: "legs", kind: "accessory" },

  // Shoulders — compound
  { name: "Overhead Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Seated Overhead Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Push Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Dumbbell Shoulder Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Seated Dumbbell Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Machine Shoulder Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Landmine Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Z Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  // Shoulders — accessory
  { name: "Lateral Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Cable Lateral Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Machine Lateral Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Front Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Rear Delt Fly", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Reverse Pec Deck", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Arnold Press", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Upright Row", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Cable Rear Delt Pull", muscle: "Shoulders", category: "shoulders", kind: "accessory" },

  // Arms — biceps
  { name: "Barbell Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "EZ Bar Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Dumbbell Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Incline Dumbbell Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Hammer Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Cross Body Hammer Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Preacher Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Machine Preacher Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Cable Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Bayesian Cable Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Concentration Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Spider Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Reverse Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Wrist Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  // Arms — triceps
  { name: "Tricep Pushdown", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Rope Pushdown", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Single Arm Pushdown", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Skull Crusher", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Overhead Tricep Extension", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Cable Overhead Extension", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Dumbbell Kickback", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "JM Press", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "Close Grip Bench Press", muscle: "Triceps", category: "arms", kind: "compound" },
  { name: "Dips", muscle: "Triceps", category: "arms", kind: "compound" },
  { name: "Weighted Dips", muscle: "Triceps", category: "arms", kind: "compound" },
  { name: "Bench Dips", muscle: "Triceps", category: "arms", kind: "accessory" },

  // Core
  { name: "Plank", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Weighted Plank", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Side Plank", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Hanging Leg Raise", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Hanging Knee Raise", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Cable Crunch", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Machine Crunch", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Ab Wheel Rollout", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Pallof Press", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Russian Twist", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Dead Bug", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Bird Dog", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Sit Up", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Weighted Sit Up", muscle: "Core", category: "core", kind: "accessory" },
  { name: "V-Up", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Mountain Climbers", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Farmer's Carry", muscle: "Core", category: "core", kind: "compound" },
  { name: "Suitcase Carry", muscle: "Core", category: "core", kind: "accessory" },

  // Olympic / full body (categorised under legs for filtering)
  { name: "Power Clean", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Hang Clean", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Clean and Jerk", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Snatch", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Kettlebell Swing", muscle: "Glutes", category: "legs", kind: "compound" },
  { name: "Thruster", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Wall Ball", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Sled Push", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Sled Pull", muscle: "Quads", category: "legs", kind: "compound" },
  // Extra catalog
  { name: "Landmine Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Landmine Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Zercher Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Safety Bar Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Pause Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Spoto Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Floor Press", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Pin Press", muscle: "Shoulders", category: "shoulders", kind: "compound" },
  { name: "Deficit Deadlift", muscle: "Back", category: "back", kind: "compound" },
  { name: "Block Pull", muscle: "Back", category: "back", kind: "compound" },
  { name: "Jefferson Deadlift", muscle: "Back", category: "back", kind: "compound" },
  { name: "Muscle Up", muscle: "Back", category: "back", kind: "compound" },
  { name: "Ring Dip", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Nordic Curl", muscle: "Hamstrings", category: "legs", kind: "accessory" },
  { name: "Sissy Squat", muscle: "Quads", category: "legs", kind: "accessory" },
  { name: "Cable Lateral Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Machine Lateral Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Reverse Pec Deck", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Spider Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Concentration Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Cross Body Hammer Curl", muscle: "Biceps", category: "arms", kind: "accessory" },
  { name: "Overhead Cable Extension", muscle: "Triceps", category: "arms", kind: "accessory" },
  { name: "JM Press", muscle: "Triceps", category: "arms", kind: "compound" },
  { name: "Cable Kickback", muscle: "Glutes", category: "legs", kind: "accessory" },
  { name: "Step Up", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Walking Lunge", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Reverse Lunge", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Goblet Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Hack Squat Machine", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Belt Squat", muscle: "Quads", category: "legs", kind: "compound" },
  { name: "Chest Press Machine", muscle: "Chest", category: "chest", kind: "compound" },
  { name: "Hammer Strength Row", muscle: "Back", category: "back", kind: "compound" },
  { name: "Y Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "W Raise", muscle: "Shoulders", category: "shoulders", kind: "accessory" },
  { name: "Dead Bug", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Bird Dog", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Ab Wheel Rollout", muscle: "Core", category: "core", kind: "accessory" },
  { name: "Toes to Bar", muscle: "Core", category: "core", kind: "accessory" },
];

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner (< 1 year)" },
  { value: "intermediate", label: "Intermediate (1-3 years)" },
  { value: "advanced", label: "Advanced (3-7 years)" },
  { value: "elite", label: "Elite (7+ years)" },
];

export const TRAINING_GOALS = [
  { value: "general_fitness", label: "General Fitness" },
  { value: "hybrid_performance", label: "Hybrid Performance" },
  { value: "endurance", label: "Endurance Focus" },
  { value: "strength", label: "Strength Focus" },
  { value: "weight_loss", label: "Weight Loss" },
  { value: "competition", label: "Competition Prep" },
];

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const IMPORT_SOURCES = [
  { id: "strava", name: "Strava", status: "available" },
  { id: "garmin", name: "Garmin", status: "available" },
  { id: "apple_health", name: "Apple Health", status: "available" },
  { id: "polar", name: "Polar", status: "available" },
  { id: "coros", name: "Coros", status: "available" },
  { id: "fitbit", name: "Fitbit", status: "available" },
  { id: "csv", name: "CSV Upload", status: "available" },
  { id: "manual", name: "Manual Entry", status: "available" },
] as const;
