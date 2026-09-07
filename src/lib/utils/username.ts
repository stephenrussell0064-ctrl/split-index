const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

/**
 * M14 / WP3.3 — two lists, because they are two different problems.
 *
 * There used to be one list holding profanity and impersonation terms together,
 * substring-matched. That is right for profanity ("fuckyou" should not pass) and
 * wrong for impersonation, and the wrongness was live: `badminton`, `grapes`,
 * `scunthorpe`, `shitake` and the surname `Rapetti` were all refused as
 * usernames. WP3.3 asks for `root`, `system`, `official`, `staff`, `help`,
 * `billing`, `security`, `api` and `null` to be reserved too — and adding those
 * to a substring test would have refused `rapid`, `therapist`, `capital`,
 * `rooted`, `staffordshire` and `Rapinoe` as well. The fix had to come before
 * the additions, or the additions would have made it worse.
 */

/**
 * Profanity. SUBSTRING matched, and deliberately blunt.
 *
 * The bluntness is a decision the shipped code already made and this keeps it:
 * for slurs a false positive is a better outcome than a false negative, and
 * App Store Guideline 1.2 asks for a filter rather than a perfect one. What it
 * gains here is a short exception list for the specific innocent words that
 * were being refused — not a fix for the general problem, which does not have
 * one.
 */
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
];

/**
 * Ordinary words that contain a blocked term and are not one.
 *
 * Exact matches on the whole normalised value, so this exempts the word itself
 * and never a string that merely contains it. Not exhaustive and cannot be —
 * it holds the cases that were demonstrably being refused, and grows when
 * somebody reports another.
 */
const NOT_ACTUALLY_PROFANITY = [
  "scunthorpe",
  "badminton",
  "grapes",
  "grape",
  "shitake",
  "shiitake",
  "therapist",
  "therapists",
  "rapeseed",
  "drapes",
  "rapetti",
  "rapid",
  "rapids",
];

/**
 * Names nobody may take, because taking one is a claim to be us.
 *
 * WHOLE-NAME matched for usernames and WORD matched for display names — never
 * a substring of a word. That distinction is the entire reason this list is
 * separate from the one above.
 */
export const RESERVED_NAMES = [
  "admin",
  "administrator",
  "moderator",
  "mod",
  "support",
  "help",
  "helpdesk",
  "staff",
  "team",
  "official",
  "root",
  "system",
  "sysadmin",
  "security",
  "billing",
  "payments",
  "api",
  "null",
  "undefined",
  "noreply",
  "webmaster",
  "abuse",
  "splitindex",
];

/**
 * Fold the characters that are not the letter they look like.
 *
 * Usernames cannot contain these — `USERNAME_PATTERN` is ASCII-only, which is
 * the strongest single thing in this file — but DISPLAY names can, and a
 * display name is what appears beside a score on a leaderboard. Cyrillic А and
 * Greek Ο are pixel-identical to the Latin letters in most fonts, so "Аdmin"
 * reads as "Admin" to every human who sees it and matched nothing at all
 * before this.
 *
 * Not a general confusables table — that is a large dependency and a moving
 * target. This is the subset that spells the words in RESERVED_NAMES.
 */
/**
 * Characters that are not the letter they look like — NON-ASCII only.
 *
 * Usernames cannot contain these: `USERNAME_PATTERN` is ASCII-only, which is
 * the strongest single thing in this file. DISPLAY names can, and a display
 * name is what appears beside a score on a leaderboard. Cyrillic \u0430 and Greek
 * \u03bf are pixel-identical to Latin a and o in most fonts, so "\u0410dmin" reads as
 * "Admin" to every human who sees it and matched nothing at all before this.
 *
 * Deliberately no digits here. Digit substitution is a SEPARATE problem handled
 * below, and mixing the two was a bug: folding `7` to `t` before stripping
 * trailing digits turned `admin7` into `admint`, which matches nothing — so
 * every case the strip existed to catch started slipping through instead.
 *
 * Not a general confusables table; that is a large dependency and a moving
 * target. This is the subset that spells the words in RESERVED_NAMES.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  "\u0430": "a", "\u0432": "b", "\u0441": "c", "\u0435": "e", "\u043d": "h", "\u0456": "i", "\u0458": "j", "\u043a": "k", "\u043c": "m",
  "\u043e": "o", "\u0440": "p", "\u0455": "s", "\u0442": "t", "\u0443": "y", "\u0445": "x",
  // Greek
  "\u03b1": "a", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x",
};

/** Leetspeak, each digit mapped to the letter it most often stands in for. */
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s",
};

function foldConfusables(value: string): string {
  return Array.from(value.toLowerCase())
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join("");
}

/** Lowercase, non-ASCII lookalikes folded, everything but a-z and 0-9 removed. */
function normalise(value: string): string {
  return foldConfusables(value).replace(/[^a-z0-9]/g, "");
}

/**
 * Every spelling of a name that a reader would take for the same word.
 *
 * A set rather than one canonical form, because the transformations conflict.
 * `admin1` is the reserved word plus a digit, so it needs the digit REMOVED.
 * `adm1n` is the reserved word with a digit standing in for a letter, so it
 * needs the digit TRANSLATED. Neither rule produces the other's answer, and
 * applying them in sequence produces neither.
 */
function spellings(raw: string): Set<string> {
  const plain = normalise(raw);
  const leet = Array.from(plain).map((ch) => LEET[ch] ?? ch).join("");
  return new Set([
    plain,
    plain.replace(/\d+$/, ""),
    leet,
    leet.replace(/\d+$/, ""),
  ]);
}

/**
 * Is this whole name reserved?
 *
 * `admin`, `admin7` and `adm1n` are refused; `badminton` is not, because it is
 * not equal to a reserved word under any of its spellings and never was. That
 * is the whole difference between this and the substring test it replaces.
 */
export function isReservedName(raw: string): boolean {
  const candidates = spellings(raw);
  return RESERVED_NAMES.some((term) => candidates.has(normalise(term)));
}

/**
 * Does any WORD in this free-text name claim to be us?
 *
 * Word-level rather than whole-value, because a display name is a phrase:
 * "Split Index Support" has to be refused and "Badminton Ben" has to be
 * allowed, and only splitting on word boundaries does both.
 */
export function containsReservedName(raw: string): boolean {
  return foldConfusables(raw)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((word) => isReservedName(word));
}

export interface UsernameValidation {
  valid: boolean;
  reason?: string;
}

/** Format + content check. Does not check uniqueness — that's a DB lookup. */
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

  if (containsBlockedTerm(username) || isReservedName(username)) {
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
  const normalised = normalise(raw);
  if (NOT_ACTUALLY_PROFANITY.includes(normalised)) return false;
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
 * as strict on CONTENT — stricter, in fact, since this is the field that can
 * carry a homoglyph.
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
  if (containsBlockedTerm(value) || containsReservedName(value)) {
    return { valid: false, reason: `That ${label.toLowerCase()} isn't available` };
  }

  return { valid: true };
}
