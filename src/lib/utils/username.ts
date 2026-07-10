const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

// Deliberately short, high-confidence list — this is a first line of
// defense against casual abuse, not a complete moderation system.
const BLOCKED_TERMS = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "rape",
  "admin",
  "moderator",
  "support",
  "splitindex",
];

export interface UsernameValidation {
  valid: boolean;
  reason?: string;
}

/** Format + profanity check. Does not check uniqueness — that's a DB lookup. */
export function validateUsernameFormat(raw: string): UsernameValidation {
  const username = raw.trim();

  if (!username) return { valid: false, reason: "Username is required" };
  if (!USERNAME_PATTERN.test(username)) {
    return {
      valid: false,
      reason:
        "3-20 characters, must start with a letter, letters/numbers/underscore only",
    };
  }

  const lower = username.toLowerCase();
  if (BLOCKED_TERMS.some((term) => lower.includes(term))) {
    return { valid: false, reason: "That username isn't available" };
  }

  return { valid: true };
}
