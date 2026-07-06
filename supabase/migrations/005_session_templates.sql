-- Session templates for quick-log recurring workouts
CREATE TABLE IF NOT EXISTS session_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sport sport_type NOT NULL,
  template_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_templates_user_sport_idx
  ON session_templates (user_id, sport);

ALTER TABLE session_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own session templates"
  ON session_templates
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- File import source (GPX, TCX, FIT)
ALTER TYPE activity_source ADD VALUE IF NOT EXISTS 'file';
