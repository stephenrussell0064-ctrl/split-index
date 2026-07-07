/**
 * Preset workout plans for The Lab.
 * Users can start a plan from /gym — it prefills the gym log form
 * with the plan's exercises so they can follow along and fill in weights.
 */

export interface PlanExercise {
  name: string;
  muscle: string;
  sets: number;
  reps: number;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  focus: string;
  level: "beginner" | "intermediate" | "advanced";
  durationMinutes: number;
  exercises: PlanExercise[];
}

export const WORKOUT_PLANS: WorkoutPlan[] = [
  {
    id: "push-day",
    name: "Push Day",
    focus: "Chest · Shoulders · Triceps",
    level: "intermediate",
    durationMinutes: 60,
    exercises: [
      { name: "Bench Press", muscle: "Chest", sets: 4, reps: 6 },
      { name: "Overhead Press", muscle: "Shoulders", sets: 3, reps: 8 },
      { name: "Incline Dumbbell Press", muscle: "Chest", sets: 3, reps: 10 },
      { name: "Lateral Raise", muscle: "Shoulders", sets: 3, reps: 15 },
      { name: "Cable Fly", muscle: "Chest", sets: 3, reps: 12 },
      { name: "Rope Pushdown", muscle: "Triceps", sets: 3, reps: 12 },
      { name: "Overhead Tricep Extension", muscle: "Triceps", sets: 3, reps: 12 },
    ],
  },
  {
    id: "pull-day",
    name: "Pull Day",
    focus: "Back · Biceps · Rear Delts",
    level: "intermediate",
    durationMinutes: 60,
    exercises: [
      { name: "Deadlift", muscle: "Back", sets: 3, reps: 5 },
      { name: "Pull Up", muscle: "Back", sets: 4, reps: 8 },
      { name: "Barbell Row", muscle: "Back", sets: 3, reps: 8 },
      { name: "Seated Cable Row", muscle: "Back", sets: 3, reps: 10 },
      { name: "Face Pull", muscle: "Back", sets: 3, reps: 15 },
      { name: "EZ Bar Curl", muscle: "Biceps", sets: 3, reps: 10 },
      { name: "Hammer Curl", muscle: "Biceps", sets: 3, reps: 12 },
    ],
  },
  {
    id: "leg-day",
    name: "Leg Day",
    focus: "Quads · Hamstrings · Glutes",
    level: "intermediate",
    durationMinutes: 65,
    exercises: [
      { name: "Squat", muscle: "Quads", sets: 4, reps: 6 },
      { name: "Romanian Deadlift", muscle: "Hamstrings", sets: 3, reps: 8 },
      { name: "Leg Press", muscle: "Quads", sets: 3, reps: 10 },
      { name: "Bulgarian Split Squat", muscle: "Quads", sets: 3, reps: 10 },
      { name: "Leg Curl", muscle: "Hamstrings", sets: 3, reps: 12 },
      { name: "Hip Thrust", muscle: "Glutes", sets: 3, reps: 10 },
      { name: "Standing Calf Raise", muscle: "Calves", sets: 4, reps: 15 },
    ],
  },
  {
    id: "upper-body",
    name: "Upper Body",
    focus: "Chest · Back · Arms",
    level: "beginner",
    durationMinutes: 55,
    exercises: [
      { name: "Bench Press", muscle: "Chest", sets: 3, reps: 8 },
      { name: "Barbell Row", muscle: "Back", sets: 3, reps: 8 },
      { name: "Overhead Press", muscle: "Shoulders", sets: 3, reps: 10 },
      { name: "Lat Pulldown", muscle: "Back", sets: 3, reps: 10 },
      { name: "Dumbbell Curl", muscle: "Biceps", sets: 2, reps: 12 },
      { name: "Tricep Pushdown", muscle: "Triceps", sets: 2, reps: 12 },
    ],
  },
  {
    id: "lower-body",
    name: "Lower Body",
    focus: "Quads · Hamstrings · Calves",
    level: "beginner",
    durationMinutes: 50,
    exercises: [
      { name: "Squat", muscle: "Quads", sets: 3, reps: 8 },
      { name: "Romanian Deadlift", muscle: "Hamstrings", sets: 3, reps: 10 },
      { name: "Leg Press", muscle: "Quads", sets: 3, reps: 12 },
      { name: "Leg Curl", muscle: "Hamstrings", sets: 3, reps: 12 },
      { name: "Calf Raise", muscle: "Calves", sets: 3, reps: 15 },
    ],
  },
  {
    id: "full-body-strength",
    name: "Full Body Strength",
    focus: "SBD · Compound focus",
    level: "intermediate",
    durationMinutes: 70,
    exercises: [
      { name: "Squat", muscle: "Quads", sets: 3, reps: 5 },
      { name: "Bench Press", muscle: "Chest", sets: 3, reps: 5 },
      { name: "Deadlift", muscle: "Back", sets: 2, reps: 5 },
      { name: "Overhead Press", muscle: "Shoulders", sets: 3, reps: 8 },
      { name: "Pull Up", muscle: "Back", sets: 3, reps: 8 },
    ],
  },
  {
    id: "five-by-five",
    name: "5×5 Classic",
    focus: "Raw strength · Linear progression",
    level: "beginner",
    durationMinutes: 60,
    exercises: [
      { name: "Squat", muscle: "Quads", sets: 5, reps: 5 },
      { name: "Bench Press", muscle: "Chest", sets: 5, reps: 5 },
      { name: "Barbell Row", muscle: "Back", sets: 5, reps: 5 },
    ],
  },
  {
    id: "hypertrophy-upper",
    name: "Hypertrophy Upper",
    focus: "Volume · Muscle growth",
    level: "advanced",
    durationMinutes: 70,
    exercises: [
      { name: "Incline Bench Press", muscle: "Chest", sets: 4, reps: 10 },
      { name: "Chest Supported Row", muscle: "Back", sets: 4, reps: 10 },
      { name: "Dumbbell Shoulder Press", muscle: "Shoulders", sets: 3, reps: 12 },
      { name: "Lat Pulldown", muscle: "Back", sets: 3, reps: 12 },
      { name: "Cable Fly", muscle: "Chest", sets: 3, reps: 15 },
      { name: "Lateral Raise", muscle: "Shoulders", sets: 4, reps: 15 },
      { name: "Preacher Curl", muscle: "Biceps", sets: 3, reps: 12 },
      { name: "Skull Crusher", muscle: "Triceps", sets: 3, reps: 12 },
    ],
  },
  {
    id: "core-conditioning",
    name: "Core & Carry",
    focus: "Trunk strength · Stability",
    level: "beginner",
    durationMinutes: 35,
    exercises: [
      { name: "Farmer's Carry", muscle: "Core", sets: 4, reps: 40 },
      { name: "Hanging Leg Raise", muscle: "Core", sets: 3, reps: 12 },
      { name: "Cable Crunch", muscle: "Core", sets: 3, reps: 15 },
      { name: "Pallof Press", muscle: "Core", sets: 3, reps: 12 },
      { name: "Back Extension", muscle: "Back", sets: 3, reps: 12 },
    ],
  },
  {
    id: "powerlifting-day",
    name: "Powerlifting Day",
    focus: "Squat · Bench · Deadlift",
    level: "advanced",
    durationMinutes: 90,
    exercises: [
      { name: "Squat", muscle: "Quads", sets: 5, reps: 3 },
      { name: "Bench Press", muscle: "Chest", sets: 5, reps: 3 },
      { name: "Deadlift", muscle: "Back", sets: 3, reps: 3 },
      { name: "Pause Squat", muscle: "Quads", sets: 2, reps: 5 },
      { name: "Close Grip Bench Press", muscle: "Chest", sets: 3, reps: 8 },
    ],
  },
  {
    id: "arnold-split",
    name: "Arnold Split",
    focus: "Chest/Back · Shoulders/Arms · Legs",
    level: "advanced",
    durationMinutes: 75,
    exercises: [
      { name: "Bench Press", muscle: "Chest", sets: 4, reps: 8 },
      { name: "Barbell Row", muscle: "Back", sets: 4, reps: 8 },
      { name: "Incline Dumbbell Press", muscle: "Chest", sets: 3, reps: 10 },
      { name: "Pull Up", muscle: "Back", sets: 3, reps: 10 },
      { name: "Cable Fly", muscle: "Chest", sets: 3, reps: 12 },
      { name: "Seated Cable Row", muscle: "Back", sets: 3, reps: 12 },
    ],
  },
  {
    id: "strongman-basics",
    name: "Strongman Basics",
    focus: "Carries · Press · Pull",
    level: "intermediate",
    durationMinutes: 55,
    exercises: [
      { name: "Farmer's Carry", muscle: "Core", sets: 4, reps: 30 },
      { name: "Log Press", muscle: "Shoulders", sets: 4, reps: 6 },
      { name: "Trap Bar Deadlift", muscle: "Back", sets: 3, reps: 5 },
      { name: "Sled Push", muscle: "Quads", sets: 4, reps: 20 },
      { name: "Kettlebell Swing", muscle: "Glutes", sets: 3, reps: 15 },
    ],
  },
  {
    id: "beginner-full-body",
    name: "Beginner Full Body",
    focus: "Learn the lifts",
    level: "beginner",
    durationMinutes: 45,
    exercises: [
      { name: "Goblet Squat", muscle: "Quads", sets: 3, reps: 10 },
      { name: "Dumbbell Bench Press", muscle: "Chest", sets: 3, reps: 10 },
      { name: "Lat Pulldown", muscle: "Back", sets: 3, reps: 10 },
      { name: "Dumbbell Shoulder Press", muscle: "Shoulders", sets: 2, reps: 12 },
      { name: "Plank", muscle: "Core", sets: 3, reps: 45 },
    ],
  },
  {
    id: "arms-day",
    name: "Arms Day",
    focus: "Biceps · Triceps",
    level: "intermediate",
    durationMinutes: 45,
    exercises: [
      { name: "Barbell Curl", muscle: "Biceps", sets: 4, reps: 10 },
      { name: "Close Grip Bench Press", muscle: "Triceps", sets: 4, reps: 8 },
      { name: "Hammer Curl", muscle: "Biceps", sets: 3, reps: 12 },
      { name: "Skull Crusher", muscle: "Triceps", sets: 3, reps: 12 },
      { name: "Preacher Curl", muscle: "Biceps", sets: 3, reps: 12 },
      { name: "Rope Pushdown", muscle: "Triceps", sets: 3, reps: 15 },
    ],
  },
  {
    id: "glute-ham-focus",
    name: "Glute & Ham Focus",
    focus: "Posterior chain",
    level: "intermediate",
    durationMinutes: 55,
    exercises: [
      { name: "Romanian Deadlift", muscle: "Hamstrings", sets: 4, reps: 8 },
      { name: "Hip Thrust", muscle: "Glutes", sets: 4, reps: 10 },
      { name: "Bulgarian Split Squat", muscle: "Quads", sets: 3, reps: 10 },
      { name: "Leg Curl", muscle: "Hamstrings", sets: 3, reps: 12 },
      { name: "Cable Kickback", muscle: "Glutes", sets: 3, reps: 15 },
      { name: "Nordic Curl", muscle: "Hamstrings", sets: 3, reps: 6 },
    ],
  },
];

export function getWorkoutPlan(id: string): WorkoutPlan | undefined {
  return WORKOUT_PLANS.find((plan) => plan.id === id);
}
