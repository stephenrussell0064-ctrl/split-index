-- Attachment picker for cable/machine exercises (user feedback:
-- "equipment/attachment picker for exercises (e.g. tricep pushdown rope vs
-- straight bar) with images/descriptions, and predictions differing per
-- attachment"). Additive/nullable — existing rows and any code not yet
-- updated keep working; scoring treats a missing attachment as "no
-- adjustment" (see resolveAttachmentMultiplierByKey in
-- src/lib/scoring/strength/attachments.ts).
ALTER TABLE gym_exercises
  ADD COLUMN IF NOT EXISTS attachment TEXT;

COMMENT ON COLUMN gym_exercises.attachment IS
  'Attachment id (e.g. "rope", "straight-bar", "v-bar") for exercises with attachment options — see EXERCISE_ATTACHMENTS in src/lib/scoring/strength/attachments.ts. Null for exercises with no attachment variants, or rows logged before this existed.';
