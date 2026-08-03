/** Preset profile icons — flat athletic-silhouette icons, no upload required. Stored as static public assets, so their URL is used directly as `avatar_url` (no Supabase Storage round-trip). */
export const PRESET_AVATARS: Array<{ id: string; url: string; label: string }> = [
  { id: "running", url: "/avatars/avatar-running.png", label: "Running" },
  { id: "lifting", url: "/avatars/avatar-lifting.png", label: "Lifting" },
  { id: "jumping", url: "/avatars/avatar-jumping.png", label: "Jumping" },
  { id: "cycling", url: "/avatars/avatar-cycling.png", label: "Cycling" },
  { id: "jumprope", url: "/avatars/avatar-jumprope.png", label: "Jump rope" },
  { id: "swimming", url: "/avatars/avatar-swimming.png", label: "Swimming" },
  { id: "yoga", url: "/avatars/avatar-yoga.png", label: "Yoga" },
  { id: "boxing", url: "/avatars/avatar-boxing.png", label: "Boxing" },
  { id: "hiking", url: "/avatars/avatar-hiking.svg", label: "Hiking" },
  { id: "rowing", url: "/avatars/avatar-rowing.svg", label: "Rowing" },
  { id: "climbing", url: "/avatars/avatar-climbing.svg", label: "Climbing" },
  { id: "dancing", url: "/avatars/avatar-dancing.svg", label: "Dancing" },
];
