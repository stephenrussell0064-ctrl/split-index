import type { FriendStatus, LeaderboardPeriod, SportType } from "@/types";
import type { IndexMetric, LeaderboardScope } from "./constants";
import type { InjuryStatus } from "./injury-status";

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  splitIndex: number;
  enduranceIndex: number | null;
  strengthIndex: number | null;
  trend: number;
  previousRank: number | null;
}

/** By Exercise / By Muscle Group / By Activity — a single-value ranking, unlike LeaderboardRow's split/endurance/strength triple. */
export interface DimensionLeaderboardRow {
  rank: number;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  /** 1RM in kg (exercise) or a 0-999 index (muscle group / activity). */
  value: number;
}

export interface LeaderboardFilters {
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  country?: string;
  ageBracket?: string;
  weightClass?: string;
  metric: IndexMetric;
}

/** Age × sex × weight bracket metadata for the current user. */
export interface BracketSummary {
  /** User's true demographic bracket — never rewritten when the view widens. */
  exactLabel: string;
  /** What is actually ranked (may be widened for population). */
  effectiveLabel: string;
  /** Rank within the effective bracket (1-based). */
  bracketRank: number | null;
  bracketSize: number;
  /** Rank among all scored athletes for this metric (1-based). */
  globalRank: number | null;
  globalSize: number;
  widenLevel: "exact" | "weight" | "age" | "sex_only" | "global";
  /** Invite CTA — only when fallback reached sex-only or global. */
  showInvitePrompt: boolean;
  /** Profile incomplete for bracketing (missing age/sex/weight). */
  unavailableReason?: "missing_profile";
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  bracket: BracketSummary | null;
}

export interface FriendProfile {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  currentSplitIndex: number | null;
  /** Opt-in, coarse, set only by that athlete themselves — see lib/social/injury-status.ts. */
  injuryStatus: InjuryStatus | null;
}

export interface FriendConnection {
  id: string;
  userId: string;
  friendId: string;
  status: FriendStatus;
  createdAt: string;
  profile: FriendProfile;
}

export interface ChallengeWithProgress {
  id: string;
  title: string;
  description: string | null;
  sport: SportType | null;
  metric: string;
  targetValue: number;
  startDate: string;
  endDate: string;
  isGlobal: boolean;
  participantCount: number;
  joined: boolean;
  progress: number;
  completed: boolean;
}

export type DuelMetric = "sessions" | "load" | "speed" | "strength";
export type DuelStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface DuelParticipant {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Live-computed standing for the duel window — sessions logged, or total load (AU). 0 until the duel is accepted and underway. */
  score: number;
}

export interface DuelWithStandings {
  id: string;
  metric: DuelMetric;
  sport: SportType | null;
  startDate: string;
  endDate: string;
  status: DuelStatus;
  /** Whether the viewing user sent this invite (vs. received it). */
  isChallenger: boolean;
  challenger: DuelParticipant;
  opponent: DuelParticipant;
  /** True once end_date has passed. */
  ended: boolean;
  /** Leading/winning user once accepted and standings differ; null while tied, pending, or declined/cancelled. */
  leaderId: string | null;
}

export interface AchievementBadge {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
}

export interface CompareSeries {
  label: string;
  username: string | null;
  color: string;
  data: { date: string; value: number }[];
}

export interface SquadMember {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  currentSplitIndex: number | null;
}

export interface SquadSummary {
  id: string;
  name: string;
  /** Only ever returned to members — used to invite others, not for display of "who's in what squad" elsewhere. */
  inviteCode: string;
  createdBy: string;
  createdAt: string;
  /** Ranked by current Split Index descending — the squad's own head-to-head view. */
  members: SquadMember[];
}

export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  country: string | null;
  preferredSports: SportType[];
  currentSplitIndex: number | null;
  currentEnduranceIndex: number | null;
  currentStrengthIndex: number | null;
  createdAt: string;
  streak: number;
  recentActivityCount: number;
  recentAvgIndex: number | null;
  /** Opt-in, coarse, set only by that athlete themselves — see lib/social/injury-status.ts. */
  injuryStatus: InjuryStatus | null;
}
