"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { motion } from "framer-motion";
import { MessageCircle, Star, Send, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/social/user-avatar";
import { SPORTS } from "@/lib/constants/sports";
import { formatDistance, formatDuration, formatPace, formatIndex } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface FeedActivity {
  id: string;
  sport: string;
  title: string | null;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationMeters: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgPowerWatts: number | null;
  avgCadence: number | null;
  avgPaceSecondsPerKm: number | null;
  temperatureCelsius: number | null;
  sessionType: string | null;
  rpe: number | null;
  notes: string | null;
  author: { userId: string; username: string | null; displayName: string | null; avatarUrl: string | null };
  /** Set by the feed query for the viewer's own activities — see src/lib/social/feed.ts. */
  isOwn: boolean;
  sportIndex: number | null;
  loadScore: number | null;
  extra: Record<string, unknown> | null;
  reactionAverage: number | null;
  reactionCount: number;
  myReaction: number | null;
  commentCount: number;
}

interface FeedComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  author: { username: string | null; displayName: string | null; avatarUrl: string | null };
}

function sportMeta(sport: string) {
  return SPORTS.find((s) => s.id === sport);
}

/** The athlete's actual name — used for the avatar, which should still show your own initials. */
function realName(author: FeedActivity["author"]): string {
  return author.displayName ?? author.username ?? "Athlete";
}

function authorName(activity: Pick<FeedActivity, "author" | "isOwn">): string {
  // Your own post is bylined "You", not your display name. Reading your own
  // name in the third person in your own feed is the small uncanny detail
  // that makes a feed feel like someone else's product.
  return activity.isOwn ? "You" : realName(activity.author);
}

/** A stat only renders when the data actually exists — "all data possible for this exercise," not a grid of blank placeholders for whatever this particular sport/session didn't record. */
function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted/70">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ScorePicker({
  activityId,
  myReaction,
  reactionAverage,
  reactionCount,
  onChange,
}: {
  activityId: string;
  myReaction: number | null;
  reactionAverage: number | null;
  reactionCount: number;
  onChange: (next: { myReaction: number | null; reactionAverage: number | null; reactionCount: number }) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function submitScore(score: number) {
    setSaving(true);
    try {
      const res = await fetch(`/api/activities/${activityId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      if (!res.ok) return;
      // Optimistic-ish: recompute the average locally from the delta rather
      // than refetching the whole feed for one tap.
      const hadMine = myReaction !== null;
      const prevSum = (reactionAverage ?? 0) * reactionCount;
      const nextCount = hadMine ? reactionCount : reactionCount + 1;
      const nextSum = hadMine ? prevSum - myReaction! + score : prevSum + score;
      onChange({ myReaction: score, reactionAverage: nextSum / nextCount, reactionCount: nextCount });
    } finally {
      setSaving(false);
    }
  }

  const display = hovered ?? myReaction ?? 0;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-0.5" onMouseLeave={() => setHovered(null)}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Score ${n} out of 10`}
            disabled={saving}
            onMouseEnter={() => setHovered(n)}
            onClick={() => submitScore(n)}
            className="p-0.5 disabled:opacity-50"
          >
            <Star
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                n <= display ? "fill-warning text-warning" : "text-muted/30"
              )}
            />
          </button>
        ))}
      </div>
      <span className="text-xs tabular-nums text-muted">
        {reactionAverage !== null
          ? `${reactionAverage.toFixed(1)}/10 (${reactionCount})`
          : "No scores yet"}
      </span>
    </div>
  );
}

function CommentsSection({ activityId, commentCount }: { activityId: string; commentCount: number }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [count, setCount] = useState(commentCount);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && comments === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/activities/${activityId}/comments`);
        const data = await res.json();
        if (res.ok) setComments(data.comments ?? []);
      } finally {
        setLoading(false);
      }
    }
  }

  async function submitComment() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/activities/${activityId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) return;
      setDraft("");
      setCount((c) => c + 1);
      // Re-fetch so the new comment shows with correctly-joined author info,
      // rather than guessing our own display fields here.
      const listRes = await fetch(`/api/activities/${activityId}/comments`);
      const listData = await listRes.json();
      if (listRes.ok) setComments(listData.comments ?? []);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="border-t border-white/5 pt-2.5">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {count > 0 ? `${count} comment${count === 1 ? "" : "s"}` : "Comment"}
      </button>

      {open && (
        <div className="mt-2.5 space-y-2.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
          {comments?.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <UserAvatar
                name={c.author.displayName ?? c.author.username ?? "Athlete"}
                avatarUrl={c.author.avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1 rounded-xl bg-white/[0.03] px-3 py-1.5">
                <p className="text-xs font-medium">
                  {c.author.displayName ?? c.author.username ?? "Athlete"}
                </p>
                <p className="text-xs text-muted break-words">{c.body}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitComment()}
              placeholder="Add a comment…"
              maxLength={1000}
              className="h-9 flex-1 rounded-lg glass px-3 text-xs text-foreground placeholder:text-muted/50"
            />
            <button
              type="button"
              aria-label="Post comment"
              disabled={posting || !draft.trim()}
              onClick={submitComment}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedPost({ activity }: { activity: FeedActivity }) {
  const meta = sportMeta(activity.sport);
  const [reaction, setReaction] = useState({
    myReaction: activity.myReaction,
    reactionAverage: activity.reactionAverage,
    reactionCount: activity.reactionCount,
  });
  const perLift = activity.extra?.perLift as
    | Record<string, { estimated1RM: number; relativeStrength: number }>
    | undefined;

  return (
    /*
      Your own posts sit in the same chronological stream as everyone else's —
      that is the point of putting them here — so they need to be tellable
      apart at a glance without being pulled out of the timeline. A tinted
      left edge and a "You" chip do that; a separate section would not.
    */
    <Card
      padding="sm"
      className={cn(activity.isOwn && "border-l-2 border-l-accent/50 bg-accent/[0.02]")}
    >
      <div className="flex items-center gap-3">
        <UserAvatar name={realName(activity.author)} avatarUrl={activity.author.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{authorName(activity)}</p>
            {activity.isOwn && (
              <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-accent">
                You
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            {formatDistanceToNow(new Date(activity.startedAt), { addSuffix: true })} ·{" "}
            {format(new Date(activity.startedAt), "MMM d, HH:mm")}
          </p>
        </div>
        {activity.sportIndex !== null && (
          <div className="shrink-0 text-right">
            <p className="font-mono text-lg font-bold tabular-nums text-accent">
              {formatIndex(activity.sportIndex)}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted/70">score</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xl">{meta?.icon ?? "🏋️"}</span>
        <p className="text-sm font-medium">
          {activity.title ?? meta?.name ?? activity.sport}
          {activity.sessionType && (
            <span className="ml-1.5 text-xs font-normal capitalize text-muted">
              · {activity.sessionType}
            </span>
          )}
        </p>
      </div>

      {activity.notes && <p className="mt-2 text-sm text-muted">{activity.notes}</p>}

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        <Stat label="Duration" value={formatDuration(activity.durationSeconds)} />
        <Stat
          label="Distance"
          value={activity.distanceMeters ? formatDistance(activity.distanceMeters) : null}
        />
        <Stat
          label="Pace"
          value={activity.avgPaceSecondsPerKm ? formatPace(activity.avgPaceSecondsPerKm) : null}
        />
        <Stat
          label="Elevation"
          value={activity.elevationMeters ? `${Math.round(activity.elevationMeters)} m` : null}
        />
        <Stat label="Avg HR" value={activity.avgHeartRate ? `${activity.avgHeartRate} bpm` : null} />
        <Stat label="Max HR" value={activity.maxHeartRate ? `${activity.maxHeartRate} bpm` : null} />
        <Stat label="Power" value={activity.avgPowerWatts ? `${Math.round(activity.avgPowerWatts)} W` : null} />
        <Stat label="Cadence" value={activity.avgCadence ? Math.round(activity.avgCadence) : null} />
        <Stat
          label="Temp"
          value={activity.temperatureCelsius != null ? `${Math.round(activity.temperatureCelsius)}°C` : null}
        />
        <Stat label="RPE" value={activity.rpe ? `${activity.rpe}/10` : null} />
        <Stat
          label="VO2max"
          value={typeof activity.extra?.vo2max === "number" ? Math.round(activity.extra.vo2max as number) : null}
        />
        <Stat
          label="DOTS"
          value={typeof activity.extra?.dotsScore === "number" ? (activity.extra.dotsScore as number).toFixed(1) : null}
        />
        <Stat
          label="IPF GL"
          value={typeof activity.extra?.glPoints === "number" ? (activity.extra.glPoints as number).toFixed(1) : null}
        />
      </div>

      {perLift && Object.keys(perLift).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(perLift).map(([name, lift]) => (
            <span key={name} className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-muted">
              {name}: {lift.estimated1RM.toFixed(0)}kg ({lift.relativeStrength.toFixed(2)}×BW)
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5">
        {activity.isOwn ? (
          /*
            No star picker on your own workout. Scoring is a thing friends do
            to each other; offering it to yourself invites padding your own
            average, and the RLS predicate would happily accept the write
            because you can always see your own activity. What you want here
            is the read-only answer to "what did they make of it?".
          */
          <p className="text-xs tabular-nums text-muted">
            {reaction.reactionAverage !== null
              ? `Your friends scored this ${reaction.reactionAverage.toFixed(1)}/10 (${reaction.reactionCount})`
              : "No scores from friends yet"}
          </p>
        ) : (
          <ScorePicker
            activityId={activity.id}
            myReaction={reaction.myReaction}
            reactionAverage={reaction.reactionAverage}
            reactionCount={reaction.reactionCount}
            onChange={setReaction}
          />
        )}
      </div>

      <CommentsSection activityId={activity.id} commentCount={activity.commentCount} />
    </Card>
  );
}

export function FeedPanel() {
  const [activities, setActivities] = useState<FeedActivity[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/social/feed");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load the feed");
        setActivities(data.activities ?? []);
        setHasMore(!!data.hasMore);
        setEmptyReason(data.emptyReason ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the feed");
      }
    })();
  }, []);

  async function loadMore() {
    if (!activities) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/social/feed?offset=${activities.length}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load more");
      setActivities((prev) => [...(prev ?? []), ...(data.activities ?? [])]);
      setHasMore(!!data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) {
    return (
      <Card padding="lg">
        <p className="text-sm text-danger">{error}</p>
      </Card>
    );
  }

  if (activities === null) {
    return (
      <Card padding="lg">
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      </Card>
    );
  }

  if (activities.length === 0) {
    // Copy has to match reality twice over. Activities are visible to accepted
    // friends by default, so "ask your friend to switch sharing on" (the old
    // text, written when this was opt-in) sends people hunting Settings for a
    // control that isn't the one they need. And the feed now includes the
    // viewer's OWN workouts, so neither of these can blame friends alone —
    // reaching this card at all means the athlete has logged nothing visible
    // either.
    return (
      <Card padding="lg">
        <div className="py-8 text-center">
          <p className="text-sm font-medium">
            {emptyReason === "no_friends"
              ? "Log a workout, or add a friend"
              : "No activities in your feed yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
            {emptyReason === "no_friends" ? (
              <>
                Your feed shows your own workouts alongside those of athletes you&apos;ve added as
                friends. Anything you log turns up here straight away — and once a friend request
                is accepted, so does theirs.
              </>
            ) : (
              <>
                Nothing from you or your friends yet. New workouts appear here automatically —
                nobody has to turn sharing on, and your own show up even if your account is
                private. (Anyone who&apos;d rather not share with friends can switch on Private
                account in Settings → Privacy.)
              </>
            )}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {activities.map((activity, i) => (
        <motion.div
          key={activity.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.04, 0.4) }}
        >
          <FeedPost activity={activity} />
        </motion.div>
      ))}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
