import type {
  DailyTrainingDayPayload,
  DailyTrainingPayload,
} from "@/lib/native/daily-training";

/**
 * When the "here is today" screen opens, and when it stays shut.
 *
 * Split out of the component so the rules can be tested without a DOM — the
 * repo carries no jsdom or React Testing Library, and these are the rules worth
 * pinning. Same reasoning as gym-timer-storage.ts.
 *
 * ONE KEY HOLDING A DATE, not a key per day. Keying by date
 * (`…takeover:2026-09-24`) would leave a dead entry in localStorage for every
 * day the athlete ever opened the app, and nothing would ever clear them.
 * Storing the date as the VALUE means the record self-expires: tomorrow's date
 * does not match today's, so the screen opens again and overwrites it.
 */

export const TAKEOVER_STORAGE_KEY = "split-index-today-takeover";

/**
 * What the server knows about what the athlete has already seen: nothing.
 *
 * localStorage does not exist during the server render, and the two sides have
 * to be free to disagree without that being a hydration mismatch — so the
 * server's snapshot is this, and it means "do not open". That is the safe
 * direction: assuming open and then closing once localStorage disagrees would
 * flash a full-screen takeover at everyone who had already dismissed it today.
 *
 * Never collides with a stored value: the only thing ever written is a
 * `yyyy-MM-dd` date.
 */
export const SEEN_UNKNOWN = "unknown";

export type SeenDate = string | null;

/**
 * The day the takeover would show, or null if there is nothing to show.
 *
 * Deliberately the same condition `TodaysSessionCard` uses to decide it has a
 * day to draw. The no-plan and between-blocks states are prompts to go and set
 * something up, and a prompt must never take over the screen — an athlete who
 * has not built a plan would be met by a full-screen advert for one every
 * morning. Those two states stay where they are, as a card on the dashboard.
 *
 * A REST DAY OPENS IT. A rest day is a prescription, not an absence: "today you
 * are not training, and here is why" is exactly as much an answer to "what am I
 * doing today" as an interval session is.
 */
export function takeoverDay(
  payload: DailyTrainingPayload | null | undefined
): DailyTrainingDayPayload | null {
  if (!payload || payload.status !== "ready") return null;
  return payload.days?.[0] ?? null;
}

/**
 * Whether to open, given what the athlete has already seen.
 *
 * ONCE A DAY, not once per launch. The dashboard is the app's landing page and
 * every tab press returns to it, so "every time the page mounts" would put a
 * full-screen takeover in front of somebody five times a morning. Once a day is
 * what "the first thing you see when you load the app up" actually means.
 *
 * `seenDate` is compared against the PLAN's own local calendar date rather than
 * anything read from the device clock. The payload's date is computed once,
 * server-side, in the athlete's own local terms — comparing it with a
 * client-side `new Date()` is how a takeover ends up reappearing at 00:00 UTC
 * for somebody in Los Angeles.
 */
export function shouldOpenTakeover(
  day: DailyTrainingDayPayload | null,
  seenDate: SeenDate
): boolean {
  if (!day) return false;
  if (seenDate === SEEN_UNKNOWN) return false;
  return seenDate !== day.date;
}

/*
 * The three pieces `useSyncExternalStore` needs, at module scope because it
 * re-subscribes whenever the reference changes and an inline arrow is a new one
 * every render — the same reasoning, and the same shape, as
 * lib/native/use-is-native-shell.ts.
 *
 * `subscribe` registers nothing. The stored date changes exactly once, when the
 * athlete dismisses the screen, and that path already re-renders the component
 * through its own state. Nothing else in the app writes this key.
 */
export const subscribeToNothing = () => () => {};

/** The client's snapshot: whatever localStorage holds. A primitive, so React can compare it. */
export const seenDateSnapshot = (): SeenDate =>
  readSeenDate(typeof window === "undefined" ? null : window.localStorage);

/** The server's snapshot: it cannot know, and must not guess. */
export const seenDateOnServer = (): SeenDate => SEEN_UNKNOWN;

/**
 * localStorage, wrapped so it can throw.
 *
 * It does: Safari in private mode, and a WebView whose site data the athlete
 * has blocked, both throw on access rather than returning null. An exception
 * here must mean "show it" and "could not remember", never a blank dashboard.
 */
export function readSeenDate(storage: Pick<Storage, "getItem"> | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(TAKEOVER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeSeenDate(
  storage: Pick<Storage, "setItem"> | null,
  date: string
): void {
  if (!storage) return;
  try {
    storage.setItem(TAKEOVER_STORAGE_KEY, date);
  } catch {
    // Nothing to do and nothing worth saying. The screen was shown, the
    // athlete dismissed it, and the worst case is that it opens again next
    // time — which is the behaviour it had before it could remember anything.
  }
}
