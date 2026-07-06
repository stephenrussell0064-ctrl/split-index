import type { ActivityFormData, SportType } from "@/types";

export type IntegrationProviderId =
  | "strava"
  | "garmin"
  | "apple_health"
  | "polar"
  | "coros"
  | "fitbit";

export type ActivitySource =
  | "manual"
  | "strava"
  | "garmin"
  | "apple_health"
  | "polar"
  | "coros"
  | "fitbit"
  | "csv"
  | "file";

export type ImportStep = "parsing" | "validating" | "scoring" | "done";

export type ImportJobStatus =
  | "pending"
  | "parsing"
  | "validating"
  | "scoring"
  | "completed"
  | "failed";

export type SyncStatus = "idle" | "syncing" | "error" | "success";

export interface ExternalActivity extends ActivityFormData {
  external_id: string;
  source: ActivitySource;
}

export interface ImportRowError {
  row?: number;
  external_id?: string;
  message: string;
}

export interface ImportPipelineResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  activityIds: string[];
}

export interface IntegrationConnectionRow {
  id: string;
  user_id: string;
  provider: IntegrationProviderId;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  provider_user_id: string | null;
  scopes: string[];
  auto_sync: boolean;
  last_sync_at: string | null;
  sync_status: SyncStatus;
  sync_error: string | null;
  metadata: Record<string, unknown>;
  connected_at: string;
  updated_at: string;
}

export interface ImportJobRow {
  id: string;
  user_id: string;
  source: ActivitySource;
  provider: IntegrationProviderId | null;
  status: ImportJobStatus;
  step: ImportStep | string;
  progress_pct: number;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportRowError[];
  result: Record<string, unknown>;
  draft_backup: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export const PROVIDER_SPORT_KEYWORDS: Record<IntegrationProviderId, Partial<Record<string, SportType>>> = {
  strava: {},
  garmin: {},
  apple_health: {},
  polar: {},
  coros: {},
  fitbit: {},
};
