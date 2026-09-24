import {
  Waves,
  Minus,
  ChevronsLeftRight,
  MoveHorizontal,
  Grip,
  TrendingUp,
  MoveRight,
  MoveUp,
} from "lucide-react";
import type { ExerciseAttachmentIcon } from "@/lib/scoring/strength/attachment-icons";

/**
 * Maps each attachment id to a distinct icon — a real visual cue standing
 * in for equipment photography (see the doc comment on
 * strength/attachments.ts for why: no photo library exists for this app,
 * and licensing real gym-equipment photos isn't a call this component
 * should make on its own). Kept in the UI layer so lucide-react never
 * leaks into the scoring engine's server-only bundle.
 */
const ICONS: Record<ExerciseAttachmentIcon, typeof Waves> = {
  rope: Waves,
  "straight-bar": Minus,
  "v-bar": ChevronsLeftRight,
  "wide-bar": MoveHorizontal,
  "single-handle": Grip,
  // Leg-press machine types: the icon is the direction the load travels, which
  // is the whole difference between them.
  "sled-45": TrendingUp,
  "horizontal-press": MoveRight,
  "vertical-press": MoveUp,
};

export function AttachmentIcon({
  icon,
  className,
}: {
  icon: ExerciseAttachmentIcon;
  className?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon className={className} />;
}
