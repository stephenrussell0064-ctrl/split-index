import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { providerDisplayName } from "./ensure-profile";

function user(meta: Record<string, unknown>, email = "stephen@example.com"): User {
  return { id: "u1", email, user_metadata: meta } as unknown as User;
}

/*
 * The last path by which an email address could reach profiles.display_name —
 * and from there the public leaderboard and the share-card PNGs. Migration 081
 * closed it in the trigger; the onboarding upsert closed it client-side; this
 * ran on every /auth/callback and still fell back to `user.email`.
 */
describe("providerDisplayName", () => {
  it("returns the provider's name, trimmed", () => {
    expect(providerDisplayName(user({ full_name: " Stephen Russell " }))).toBe("Stephen Russell");
  });

  it("never returns the email, even when the provider put it in the name field", () => {
    expect(providerDisplayName(user({}))).toBeNull();
    expect(providerDisplayName(user({ full_name: "stephen@example.com" }))).toBeNull();
    expect(providerDisplayName(user({ full_name: "" }))).toBeNull();
    expect(providerDisplayName(user({ full_name: 42 }))).toBeNull();
  });
});
