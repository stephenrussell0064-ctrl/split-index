"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, GitCompare, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/social/user-avatar";
import { formatIndex } from "@/lib/utils/format";
import type { FriendConnection } from "@/lib/social/types";

interface FriendsPanelProps {
  initialFriends: FriendConnection[];
  initialIncoming: FriendConnection[];
  initialOutgoing: FriendConnection[];
  onCompare: (username: string | null, userId: string) => void;
}

export function FriendsPanel({
  initialFriends,
  initialIncoming,
  initialOutgoing,
  onCompare,
}: FriendsPanelProps) {
  const [friends, setFriends] = useState(initialFriends);
  const [incoming, setIncoming] = useState(initialIncoming);
  const [outgoing, setOutgoing] = useState(initialOutgoing);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/friends");
    const data = await res.json();
    if (res.ok) {
      setFriends(data.friends);
      setIncoming(data.incoming);
      setOutgoing(data.outgoing);
    }
  }

  async function sendRequest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsername("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send request");
    } finally {
      setLoading(false);
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    await fetch("/api/friends", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    await refresh();
  }

  async function removeFriend(id: string) {
    await fetch(`/api/friends?id=${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <CardTitle>Friends</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search by @username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="flex-1"
            />
            <Button size="sm" loading={loading} onClick={sendRequest}>
              <UserPlus className="h-4 w-4" />
              Add
            </Button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}

          {incoming.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Pending Requests
              </p>
              <div className="space-y-2">
                {incoming.map((req, i) => (
                  <motion.div
                    key={req.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 rounded-xl glass p-3"
                  >
                    <UserAvatar
                      name={req.profile.displayName ?? req.profile.username ?? "?"}
                      avatarUrl={req.profile.avatarUrl}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">
                        {req.profile.displayName ?? req.profile.username}
                      </p>
                      <p className="text-xs text-muted">@{req.profile.username}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => respond(req.id, "accept")}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => respond(req.id, "decline")}>
                      <X className="h-3 w-3" />
                    </Button>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {outgoing.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Sent Requests
              </p>
              <div className="space-y-2">
                {outgoing.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 rounded-xl p-3 text-sm text-muted"
                  >
                    <UserAvatar
                      name={req.profile.displayName ?? "?"}
                      avatarUrl={req.profile.avatarUrl}
                      size="sm"
                    />
                    <span className="flex-1 truncate">
                      {req.profile.displayName ?? req.profile.username} — pending
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFriend(req.id)}
                      className="text-xs hover:text-danger"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              Your Friends ({friends.length})
            </p>
            {friends.length === 0 ? (
              <p className="text-sm text-muted">
                Connect with training partners to compare indices.
              </p>
            ) : (
              <div className="space-y-2">
                {friends.map((friend, i) => (
                  <motion.div
                    key={friend.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 rounded-xl p-3 hover:bg-white/5"
                  >
                    <UserAvatar
                      name={friend.profile.displayName ?? "?"}
                      avatarUrl={friend.profile.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      {friend.profile.username ? (
                        <Link
                          href={`/social/profile/${friend.profile.username}`}
                          className="block truncate text-sm font-medium hover:text-accent"
                        >
                          {friend.profile.displayName ?? friend.profile.username}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium">
                          {friend.profile.displayName}
                        </p>
                      )}
                      {friend.profile.currentSplitIndex != null && (
                        <p className="text-xs text-muted">
                          Index {formatIndex(friend.profile.currentSplitIndex)}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onCompare(friend.profile.username, friend.profile.userId)
                      }
                    >
                      <GitCompare className="h-3 w-3" />
                    </Button>
                    <button
                      type="button"
                      onClick={() => removeFriend(friend.id)}
                      className="rounded-lg p-1.5 text-muted hover:text-danger"
                    >
                      <UserMinus className="h-3 w-3" />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
