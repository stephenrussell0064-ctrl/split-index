const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

// Deliberately short, high-confidence list — this is a first line of
// defense against casual abuse, not a complete moderation system.
//
// App Store Guideline 1.2 requires "a method for filtering objectionable
// material from being posted to the app". This list was the whole of that
// method and it only ever ran on usernames, while display names, squad names
// and duel names — all of them visible to other athletes — went unchecked.
// `containsBlockedTerm` and `validateDisplayText` below extend it to those,
// which is why the list is exported now rather than being file-private.
export const BLOCKED_TERMS = [
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

/**
 * Does this free-text field contain a term we will not publish?
 *
 * Separator-insensitive on purpose: "f-u-c-k" and "f u c k" are the first two
 * things anyone tries, and a substring check on the raw string misses both.
 * Non-alphanumeric characters are stripped before matching, so the filter sees
 * what a reader sees rather than what was typed.
 *
 * This is not, and is not claimed to be, a complete moderation system. It is the
 * automated half of Guideline 1.2; the reporting queue is the human half, and
 * blocking is what an athlete can do without waiting for either.
 */
export function containsBlockedTerm(raw: string): boolean {
  const normalised = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BLOCKED_TERMS.some((term) => normalised.includes(term));
}

export interface DisplayTextValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Format and content check for any name one athlete types and another reads —
 * display names, squad names, duel titles.
 *
 * Deliberately looser on FORMAT than `validateUsernameFormat` (a display name
 * may contain spaces, accents and punctuation; a username may not) and exactly
 * as strict on CONTENT.
 */
export function validateDisplayText(
  raw: string,
  { label = "Name", maxLength = 50, minLength = 1 }: { label?: string; maxLength?: number; minLength?: number } = {}
): DisplayTextValidation {
  const value = raw.trim();

  if (value.length < minLength) return { valid: false, reason: `${label} is required` };
  if (value.length > maxLength) {
    return { valid: false, reason: `${label} must be ${maxLength} characters or fewer` };
  }
  // Control characters and newlines: invisible in a form, and able to break the
  // layout of every list the value is rendered into.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { valid: false, reason: `${label} contains characters that aren't allowed` };
  }
  if (containsBlockedTerm(value)) {
    return { valid: false, reason: `That ${label.toLowerCase()} isn't available` };
  }

  return { valid: true };
}
