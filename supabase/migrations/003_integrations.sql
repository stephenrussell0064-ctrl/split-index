-- Split Index — Integrations & Import Jobs
-- OAuth connections, sync state, and import progress tracking

CREATE TYPE integration_provider AS ENUM (
  'strava', 'garmin', 'apple_health', 'polar', 'coros', 'fitbit'
);

CREATE TYPE import_job_status AS ENUM (
  'pending', 'parsing', 'validating', 'scoring', 'completed', 'failed'
);

CREATE TYPE sync_status AS ENUM (
  'idle', 'syncing', 'error', 'success'
);

-- ─── Integration Connections ──────────────────────────────────────────────────
CREATE TABLE integration_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider integration_provider NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  provider_user_id TEXT,
  scopes TEXT[] DEFAULT '{}',
  auto_sync BOOLEAN DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ,
  sync_status sync_status DEFAULT 'idle',
  sync_error TEXT,
  metadata JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_integration_connections_auto_sync
  ON integration_connections(auto_sync, provider)
  WHERE auto_sync = TRUE;

-- ─── Import Jobs ──────────────────────────────────────────────────────────────
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source activity_source NOT NULL,
  provider integration_provider,
  status import_job_status DEFAULT 'pending',
  step TEXT DEFAULT 'parsing',
  progress_pct INTEGER DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  total INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  result JSONB DEFAULT '{}',
  draft_backup JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_import_jobs_user ON import_jobs(user_id, created_at DESC);

CREATE TRIGGER integration_connections_updated_at
  BEFORE UPDATE ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own integration connections"
  ON integration_connections FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own import jobs"
  ON import_jobs FOR ALL
  USING (auth.uid() = user_id);
