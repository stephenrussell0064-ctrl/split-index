import type { FriendStatus, LeaderboardPeriod, SportType } from "@/types";
import type { IndexMetric, LeaderboardScope } from "./constants";

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

export interface LeaderboardFilters {
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  country?: string;
  ageBracket?: string;
  weightClass?: string;
  metric: IndexMetric;
}

export interface FriendProfile {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  currentSplitIndex: number | null;
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
}
