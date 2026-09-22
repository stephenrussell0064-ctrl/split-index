import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFriendSuggestions } from "./suggestions";

/**
 * Suggesting people is a privacy surface before it is a feature. Every test
 * here is either "does it find the right people" or "does it refuse to surface
 * someone it must not", and the second kind outnumbers the first on purpose.
 */

type Table = Record<string, { data?: unknown[]; error?: { message: string } | null }>;

function fake(tables: Table) {
  const client = {
    from(table: string) {
      const result = tables[table] ?? { data: [] };
      const b: Record<string, unknown> = {};
      const chain = () => b;
      b.select = chain;
      b.eq = chain;
      b.in = chain;
      b.gte = chain;
      b.or = () => Promise.resolve({ data: result.data ?? [], error: result.error ?? null });
      // Terminal when no .or() follows (squad_members path).
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? [], error: result.error ?? null }).then(res);
      return b;
    },
  } as unknown as SupabaseClient;
  return client;
}

const ME = "me";
const rel = (a: string, b: string, status = "accepted") => ({ user_id: a, friend_id: b, status });

describe("friend suggestions", () => {
  it("suggests a friend's friend, and counts the mutual", async () => {
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", "bob")] },
        blocked_users: { data: [] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions.map((s) => s.userId)).toContain("bob");
    expect(suggestions.find((s) => s.userId === "bob")?.mutualFriends).toBe(1);
  });

  it("never suggests someone already a friend", async () => {
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", "bob"), rel(ME, "bob")] },
        blocked_users: { data: [] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions.map((s) => s.userId)).not.toContain("bob");
  });

  it("never suggests someone with a request already pending, in either direction", async () => {
    // Suggesting someone you already asked, or who already asked you, reads as
    // the app having lost track of its own state.
    for (const pending of [rel(ME, "bob", "pending"), rel("bob", ME, "pending")]) {
      const { suggestions } = await fetchFriendSuggestions(
        fake({
          friends: { data: [rel(ME, "alice"), rel("alice", "bob"), pending] },
          blocked_users: { data: [] },
          squad_members: { data: [] },
        }),
        ME
      );
      expect(suggestions.map((s) => s.userId)).not.toContain("bob");
    }
  });

  it("never suggests someone this athlete blocked", async () => {
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", "bob")] },
        blocked_users: { data: [{ blocker_id: ME, blocked_id: "bob" }] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions.map((s) => s.userId)).not.toContain("bob");
  });

  it("never suggests someone who blocked THIS athlete", async () => {
    // The direction that is easy to forget. A block must not hand the blocked
    // person a route back to the blocker.
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", "bob")] },
        blocked_users: { data: [{ blocker_id: "bob", blocked_id: ME }] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions.map((s) => s.userId)).not.toContain("bob");
  });

  it("never suggests the athlete themselves", async () => {
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", ME)] },
        blocked_users: { data: [] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions.map((s) => s.userId)).not.toContain(ME);
  });

  it("shows nobody without a reason to show them", async () => {
    // A suggestion the athlete cannot account for is worse than no suggestion.
    const { suggestions } = await fetchFriendSuggestions(
      fake({ friends: { data: [] }, blocked_users: { data: [] }, squad_members: { data: [] } }),
      ME
    );
    expect(suggestions).toEqual([]);
  });

  it("ranks more mutual friends higher", async () => {
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: {
          data: [
            rel(ME, "alice"),
            rel(ME, "amy"),
            rel("alice", "bob"),
            rel("amy", "bob"),
            rel("alice", "carl"),
          ],
        },
        blocked_users: { data: [] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions[0].userId).toBe("bob");
    expect(suggestions[0].mutualFriends).toBeGreaterThan(
      suggestions.find((s) => s.userId === "carl")?.mutualFriends ?? 0
    );
  });

  it("reports a failed relationship read rather than returning an empty list", async () => {
    // An empty suggestion list and an unreadable one look identical on screen,
    // and only one of them means "you have nobody to add".
    const { suggestions, error } = await fetchFriendSuggestions(
      fake({ friends: { error: { message: "boom" } }, blocked_users: { data: [] }, squad_members: { data: [] } }),
      ME
    );
    expect(suggestions).toEqual([]);
    expect(error).toBe("boom");
  });

  it("refuses to proceed if the block list cannot be read", async () => {
    // The one failure that must never degrade to "carry on": suggestions built
    // without the block list can surface exactly the person being avoided.
    const { suggestions, error } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", "bob")] },
        blocked_users: { error: { message: "blocks unavailable" } },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions).toEqual([]);
    expect(error).toBe("blocks unavailable");
  });

  it("returns no sports, because a candidate's training is not readable", async () => {
    const { suggestions } = await fetchFriendSuggestions(
      fake({
        friends: { data: [rel(ME, "alice"), rel("alice", "bob")] },
        blocked_users: { data: [] },
        squad_members: { data: [] },
      }),
      ME
    );
    expect(suggestions[0].sharedSports).toEqual([]);
  });
});
