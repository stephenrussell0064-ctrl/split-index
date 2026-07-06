-- Split Index — Production Supabase Schema
-- Run via: supabase db push OR paste into Supabase SQL editor

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE sport_type AS ENUM (
  'running', 'walking', 'swimming', 'rowing',
  'bike_erg', 'indoor_cycling', 'ski_erg', 'gym'
);

CREATE TYPE session_type AS ENUM (
  'easy', 'recovery', 'tempo', 'threshold',
  'interval', 'race', 'long', 'other'
);

CREATE TYPE gender_type AS ENUM (
  'male', 'female', 'other', 'prefer_not_to_say'
);

CREATE TYPE experience_level AS ENUM (
  'beginner', 'intermediate', 'advanced', 'elite'
);

CREATE TYPE training_goal AS ENUM (
  'general_fitness', 'hybrid_performance', 'endurance',
  'strength', 'weight_loss', 'competition'
);

CREATE TYPE activity_source AS ENUM (
  'manual', 'strava', 'garmin', 'apple_health',
  'polar', 'coros', 'fitbit', 'csv'
);

CREATE TYPE subscription_tier AS ENUM ('free', 'premium');

CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete'
);

CREATE TYPE friend_status AS ENUM ('pending', 'accepted', 'blocked');

-- ─── Profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  country TEXT,
  age INTEGER CHECK (age >= 13 AND age <= 120),
  height_cm NUMERIC(5,1) CHECK (height_cm > 0),
  weight_kg NUMERIC(5,1) CHECK (weight_kg > 0),
  max_hr INTEGER CHECK (max_hr >= 100 AND max_hr <= 230),
  gender gender_type,
  experience experience_level,
  training_history_years NUMERIC(4,1) DEFAULT 0,
  goals training_goal[] DEFAULT '{}',
  preferred_sports sport_type[] DEFAULT '{}',
  onboarding_completed BOOLEAN DEFAULT FALSE,
  subscription_tier subscription_tier DEFAULT 'free',
  subscription_status subscription_status,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Body Metrics ─────────────────────────────────────────────────────────────
CREATE TABLE body_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_kg NUMERIC(5,1) NOT NULL,
  body_fat_percent NUMERIC(4,1),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Activities ───────────────────────────────────────────────────────────────
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport sport_type NOT NULL,
  title TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  distance_meters NUMERIC(10,1),
  elevation_meters NUMERIC(8,1),
  avg_heart_rate INTEGER CHECK (avg_heart_rate >= 40 AND avg_heart_rate <= 230),
  max_heart_rate INTEGER,
  avg_power_watts NUMERIC(7,1),
  avg_cadence NUMERIC(6,1),
  avg_pace_seconds_per_km NUMERIC(8,2),
  avg_split_seconds NUMERIC(8,2),
  stroke_type TEXT,
  temperature_celsius NUMERIC(4,1),
  session_type session_type,
  rpe NUMERIC(3,1) CHECK (rpe >= 1 AND rpe <= 10),
  notes TEXT,
  source activity_source DEFAULT 'manual',
  external_id TEXT,
  is_draft BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source, external_id)
);

CREATE INDEX idx_activities_user_started ON activities(user_id, started_at DESC);
CREATE INDEX idx_activities_sport ON activities(user_id, sport);

-- ─── Gym Exercises ────────────────────────────────────────────────────────────
CREATE TABLE gym_exercises (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,
  weight_kg NUMERIC(6,2) NOT NULL,
  sets INTEGER NOT NULL CHECK (sets > 0),
  reps INTEGER NOT NULL CHECK (reps > 0),
  rpe NUMERIC(3,1) CHECK (rpe >= 1 AND rpe <= 10),
  estimated_1rm_kg NUMERIC(6,2),
  order_index INTEGER DEFAULT 0
);

-- ─── Workout Scores ───────────────────────────────────────────────────────────
CREATE TABLE workout_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport sport_type NOT NULL,
  sport_index INTEGER NOT NULL CHECK (sport_index >= 0 AND sport_index <= 999),
  endurance_component NUMERIC(6,2),
  strength_component NUMERIC(6,2),
  fatigue_impact NUMERIC(5,2) DEFAULT 0,
  load_score NUMERIC(8,2) DEFAULT 0,
  score_breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workout_scores_user ON workout_scores(user_id, created_at DESC);

-- ─── Split Index History ──────────────────────────────────────────────────────
CREATE TABLE split_index_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  split_index INTEGER NOT NULL CHECK (split_index >= 0 AND split_index <= 999),
  endurance_index INTEGER NOT NULL,
  strength_index INTEGER NOT NULL,
  fatigue_score NUMERIC(5,2) DEFAULT 0,
  recovery_score NUMERIC(5,2) DEFAULT 100,
  predicted_index_7d INTEGER,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_split_index_user_time ON split_index_history(user_id, recorded_at DESC);

-- ─── Personal Records ─────────────────────────────────────────────────────────
CREATE TABLE personal_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport sport_type NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(12,4) NOT NULL,
  unit TEXT NOT NULL,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, sport, metric)
);

-- ─── Goals ────────────────────────────────────────────────────────────────────
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  target_split_index INTEGER,
  target_sport sport_type,
  target_value NUMERIC(10,2),
  deadline DATE,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Recovery & Sleep ─────────────────────────────────────────────────────────
CREATE TABLE recovery_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recovery_score NUMERIC(5,2) NOT NULL,
  fatigue_score NUMERIC(5,2) NOT NULL,
  sleep_hours NUMERIC(4,1),
  hrv_ms NUMERIC(6,1),
  resting_hr INTEGER,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── AI Feedback ──────────────────────────────────────────────────────────────
CREATE TABLE ai_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  performance_explanation TEXT NOT NULL,
  recovery_advice TEXT NOT NULL,
  next_workout_recommendation TEXT NOT NULL,
  long_term_insight TEXT NOT NULL,
  score_change_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Friends ──────────────────────────────────────────────────────────────────
CREATE TABLE friends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status friend_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id),
  CHECK (user_id != friend_id)
);

-- ─── Challenges ───────────────────────────────────────────────────────────────
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  sport sport_type,
  metric TEXT NOT NULL,
  target_value NUMERIC(12,4) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_global BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE challenge_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  progress NUMERIC(12,4) DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(challenge_id, user_id)
);

-- ─── Achievements ─────────────────────────────────────────────────────────────
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  criteria JSONB DEFAULT '{}'
);

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- ─── Draft Workouts (auto-save) ───────────────────────────────────────────────
CREATE TABLE workout_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport sport_type NOT NULL,
  form_data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, sport)
);

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER activities_updated_at BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Auto-create profile on signup ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── Row Level Security ─────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_index_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_drafts ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (username IS NOT NULL);

-- Body metrics
CREATE POLICY "Users manage own body metrics" ON body_metrics FOR ALL USING (auth.uid() = user_id);

-- Activities
CREATE POLICY "Users manage own activities" ON activities FOR ALL USING (auth.uid() = user_id);

-- Gym exercises (via activity ownership)
CREATE POLICY "Users manage own gym exercises" ON gym_exercises FOR ALL
  USING (EXISTS (SELECT 1 FROM activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));

-- Workout scores
CREATE POLICY "Users manage own scores" ON workout_scores FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public leaderboard scores" ON workout_scores FOR SELECT USING (true);

-- Split index history
CREATE POLICY "Users manage own index history" ON split_index_history FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public leaderboard index" ON split_index_history FOR SELECT USING (true);

-- Personal records
CREATE POLICY "Users manage own PRs" ON personal_records FOR ALL USING (auth.uid() = user_id);

-- Goals
CREATE POLICY "Users manage own goals" ON goals FOR ALL USING (auth.uid() = user_id);

-- Recovery
CREATE POLICY "Users manage own recovery" ON recovery_snapshots FOR ALL USING (auth.uid() = user_id);

-- AI feedback
CREATE POLICY "Users manage own AI feedback" ON ai_feedback FOR ALL USING (auth.uid() = user_id);

-- Friends
CREATE POLICY "Users manage own friendships" ON friends FOR ALL
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Challenge participants
CREATE POLICY "Users manage own challenge participation" ON challenge_participants FOR ALL
  USING (auth.uid() = user_id);
CREATE POLICY "Public challenge progress" ON challenge_participants FOR SELECT USING (true);

-- User achievements
CREATE POLICY "Users manage own achievements" ON user_achievements FOR ALL USING (auth.uid() = user_id);

-- Notifications
CREATE POLICY "Users manage own notifications" ON notifications FOR ALL USING (auth.uid() = user_id);

-- Workout drafts
CREATE POLICY "Users manage own drafts" ON workout_drafts FOR ALL USING (auth.uid() = user_id);

-- Challenges (public read)
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view challenges" ON challenges FOR SELECT USING (true);

-- Achievements (public read)
CREATE POLICY "Anyone can view achievements" ON achievements FOR SELECT USING (true);

-- ─── Seed achievements ──────────────────────────────────────────────────────────
INSERT INTO achievements (slug, title, description, icon) VALUES
  ('first_workout', 'First Index', 'Log your first workout', 'zap'),
  ('index_500', 'Half Thousand', 'Reach Split Index 500', 'trending-up'),
  ('index_750', 'Elite Territory', 'Reach Split Index 750', 'crown'),
  ('week_streak', 'Seven Days Strong', 'Train 7 days in a row', 'flame'),
  ('hybrid_athlete', 'True Hybrid', 'Score 400+ in both strength and endurance', 'scale'),
  ('pr_machine', 'Record Breaker', 'Set 5 personal records', 'trophy');
