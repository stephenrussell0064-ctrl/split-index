/**
 * Pure type — deliberately zero dependencies (no lucide-react/React import
 * here) so the scoring engine and API routes that pull in attachments.ts
 * never drag UI packages into a server-only bundle. The actual icon-per-id
 * mapping lives in the UI layer (components/gym/attachment-picker.tsx).
 */
export type ExerciseAttachmentIcon =
  | "rope"
  | "straight-bar"
  | "v-bar"
  | "wide-bar"
  | "single-handle"
  // Leg-press machine types. Same mechanism, different noun — see
  // getAttachmentPickerLabel in attachments.ts.
  | "sled-45"
  | "horizontal-press"
  | "vertical-press";
