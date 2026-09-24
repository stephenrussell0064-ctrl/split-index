import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TakeoverDialog,
  TodaysSessionTakeover,
} from "@/components/dashboard/todays-session-takeover";
import {
  SEEN_UNKNOWN,
  TAKEOVER_STORAGE_KEY,
  readSeenDate,
  seenDateOnServer,
  seenDateSnapshot,
  shouldOpenTakeover,
  takeoverDay,
  writeSeenDate,
} from "@/components/dashboard/todays-session-takeover-state";
import type { DailyTrainingPayload } from "@/lib/native/daily-training";

/**
 * "i want a whole screen displaying what you should be doing today as part of
 * the plan when you load the app up, and then you can click off of it".
 *
 * The rules live in todays-session-takeover-state.ts precisely so they can be
 * tested here: the repo carries no jsdom or React Testing Library, so the
 * component's own effects never run in a test (see
 * personal-score-explainer.test.tsx for the same constraint). Everything that
 * decides WHETHER the screen opens is therefore a pure function, and the
 * component is left holding only the parts a test could not reach anyway.
 */

const payload = (over: Partial<DailyTrainingPayload> = {}): DailyTrainingPayload => ({
  status: "ready",
  days: [
    {
      date: "2026-09-24",
      isRest: false,
      weekLabel: "Week 3 · Build",
      totalMinutes: 75,
      sessions: [
        {
          title: "Threshold intervals",
          detail: "5 x 6 min at threshold, 90 s jog",
          domain: "endurance",
          minutes: 50,
          isQuality: true,
          slot: "AM",
        },
        {
          title: "Lower body",
          detail: "Squat 4x5, RDL 3x8",
          domain: "strength",
          minutes: 25,
          isQuality: false,
        },
      ],
    },
  ],
  ...over,
});

describe("which states take over the screen", () => {
  it("opens for a live block with a day to show", () => {
    expect(takeoverDay(payload())).not.toBeNull();
  });

  it("opens for a rest day — a rest day is a prescription, not an absence", () => {
    const rest = payload({
      days: [
        {
          date: "2026-09-24",
          isRest: true,
          restReason: "Third quality session this week lands tomorrow.",
          weekLabel: "Week 3 · Build",
          totalMinutes: 0,
          sessions: [],
        },
      ],
    });
    expect(takeoverDay(rest)).not.toBeNull();
    expect(renderToStaticMarkup(<TodaysSessionTakeover payload={rest} />)).toBe("");
  });

  /*
    The three states that must NEVER take over the screen. An athlete who has
    not built a plan being met by a full-screen advert for one every morning is
    the failure mode this is guarding.
  */
  it("stays shut with no plan", () => {
    expect(takeoverDay(payload({ status: "noPlan", days: undefined }))).toBeNull();
  });

  it("stays shut between blocks", () => {
    expect(takeoverDay(payload({ status: "betweenBlocks", days: undefined }))).toBeNull();
  });

  it("stays shut when the payload is null or has no days", () => {
    expect(takeoverDay(null)).toBeNull();
    expect(takeoverDay(payload({ days: [] }))).toBeNull();
  });
});

describe("once a day, not once a mount", () => {
  const day = takeoverDay(payload())!;

  it("opens when nothing has been seen", () => {
    expect(shouldOpenTakeover(day, null)).toBe(true);
  });

  it("stays shut for the rest of the day once dismissed", () => {
    expect(shouldOpenTakeover(day, "2026-09-24")).toBe(false);
  });

  it("opens again tomorrow", () => {
    expect(shouldOpenTakeover(day, "2026-09-23")).toBe(true);
  });

  it("never opens without a day, whatever was seen", () => {
    expect(shouldOpenTakeover(null, null)).toBe(false);
  });

  /*
    The server cannot read localStorage, so it must not guess. Guessing "not
    seen" would put the takeover in the server HTML and flash it at every
    athlete who had already dismissed it today — the failure this sentinel
    exists to prevent. `seenDateOnServer` is what useSyncExternalStore renders
    with on the server and through the hydration pass.
  */
  it("stays shut while the server cannot know", () => {
    expect(shouldOpenTakeover(day, SEEN_UNKNOWN)).toBe(false);
    expect(seenDateOnServer()).toBe(SEEN_UNKNOWN);
  });

  it("opens once the client's snapshot replaces it", () => {
    expect(shouldOpenTakeover(day, seenDateSnapshot())).toBe(true);
  });
});

describe("the record is one key holding a date", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it("round-trips the date under a single key", () => {
    const storage = fakeStorage();
    writeSeenDate(storage, "2026-09-24");
    expect(storage.map.size).toBe(1);
    expect(readSeenDate(storage)).toBe("2026-09-24");
  });

  it("overwrites rather than accumulating a key per day", () => {
    const storage = fakeStorage();
    writeSeenDate(storage, "2026-09-24");
    writeSeenDate(storage, "2026-09-25");
    expect(storage.map.size).toBe(1);
    expect(storage.map.get(TAKEOVER_STORAGE_KEY)).toBe("2026-09-25");
  });

  /*
    Safari in private mode and a WebView with site data blocked both THROW on
    access rather than returning null. Neither may take the dashboard down with
    them: the screen shows, and the worst case is that it shows again.
  */
  it("treats a throwing storage as 'not seen' rather than propagating", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readSeenDate(throwing)).toBeNull();
    expect(() => writeSeenDate(throwing, "2026-09-24")).not.toThrow();
    expect(shouldOpenTakeover(takeoverDay(payload())!, readSeenDate(throwing))).toBe(true);
  });

  it("survives having no storage at all", () => {
    expect(readSeenDate(null)).toBeNull();
    expect(() => writeSeenDate(null, "2026-09-24")).not.toThrow();
  });
});

describe("the screen itself", () => {
  const day = takeoverDay(
    payload({
      days: [
        {
          date: "2026-09-24",
          isRest: false,
          weekLabel: "Week 3 · Build",
          totalMinutes: 110,
          sessions: [
            {
              title: "Threshold intervals",
              detail: "5 x 6 min at threshold, 90 s jog recovery. Hold 4:05/km.",
              domain: "endurance",
              minutes: 50,
              isQuality: true,
              slot: "AM",
            },
            {
              title: "Lower body",
              detail: "Squat 4x5 at 100 kg, RDL 3x8, calf raises 3x12.",
              domain: "strength",
              minutes: 35,
              isQuality: false,
              slot: "PM",
            },
            { title: "Shakeout", detail: "20 min easy, flat.", domain: "endurance", minutes: 25, isQuality: false },
          ],
        },
      ],
    })
  )!;
  const html = renderToStaticMarkup(<TakeoverDialog day={day} onDismiss={() => {}} />);

  it("covers the whole screen", () => {
    expect(html).toContain("fixed inset-0 z-50");
  });

  it("is a modal dialog to a screen reader", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // The apostrophe arrives HTML-escaped out of renderToStaticMarkup.
    expect(html).toContain("aria-label=\"Today&#x27;s training\"");
  });

  /*
    All three dismissals. The backdrop is what "click off of it" means, and it
    is a real button so a keyboard reaches it; Escape is useDialog's and has no
    markup to assert. Two labelled "Dismiss" controls — backdrop and X.
  */
  it("can be clicked off", () => {
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(2);
    expect(html).toContain("Got it");
  });

  it("shows every session, not the two the dashboard band has room for", () => {
    expect(html).toContain("Threshold intervals");
    expect(html).toContain("Lower body");
    expect(html).toContain("Shakeout");
    expect(html).not.toContain("more session");
  });

  it("shows each session's detail in full, with nothing clamped", () => {
    expect(html).toContain("5 x 6 min at threshold, 90 s jog recovery. Hold 4:05/km.");
    expect(html).toContain("Squat 4x5 at 100 kg, RDL 3x8, calf raises 3x12.");
    expect(html).not.toContain("line-clamp");
  });

  it("names the day in the athlete's own terms, from the plan's date", () => {
    // 2026-09-24 is a Thursday. Parsed as a local date, not a UTC instant —
    // `new Date("2026-09-24")` is midnight UTC and reads as the 23rd anywhere
    // west of Greenwich.
    expect(html).toContain("Thursday 24 September");
    expect(html).toContain("Week 3 · Build");
    expect(html).toContain("110 min total");
  });

  it("carries the slot and quality markers the plan set", () => {
    expect(html).toContain("AM");
    expect(html).toContain("PM");
    expect(html).toContain("Quality");
  });

  it("insets with max() so iPad compatibility mode does not collapse them to zero", () => {
    expect(html).toContain("env(safe-area-inset-top)");
    expect(html).toContain("max(1.5rem,env(safe-area-inset-top))");
    expect(html).toContain("max(1.5rem,env(safe-area-inset-bottom))");
  });

  it("renders a rest day as the prescription, with the plan's own reason", () => {
    const restDay = takeoverDay(
      payload({
        days: [
          {
            date: "2026-09-24",
            isRest: true,
            restReason: "Two quality sessions in three days and the long run is tomorrow.",
            weekLabel: "Week 3 · Build",
            totalMinutes: 0,
            sessions: [],
          },
        ],
      })
    )!;
    const restHtml = renderToStaticMarkup(<TakeoverDialog day={restDay} onDismiss={() => {}} />);
    expect(restHtml).toContain("Rest day");
    expect(restHtml).toContain("Two quality sessions in three days and the long run is tomorrow.");
    // No invented reason, and no "0 min total" hanging off a day with no work.
    expect(restHtml).not.toContain("min total");
  });

  it("says nothing about a rest day the plan gave no reason for", () => {
    const bare = takeoverDay(
      payload({
        days: [
          {
            date: "2026-09-24",
            isRest: true,
            weekLabel: "Week 3 · Build",
            totalMinutes: 0,
            sessions: [],
          },
        ],
      })
    )!;
    const bareHtml = renderToStaticMarkup(<TakeoverDialog day={bare} onDismiss={() => {}} />);
    expect(bareHtml).toContain("Rest day");
    expect(bareHtml).toContain("Week 3 · Build");
  });
});

describe("it renders nothing on the server", () => {
  /*
    `open` starts false and is decided in an effect, which never runs under SSR.
    The alternative — assume open, then hide once localStorage disagrees —
    would flash a full-screen takeover at every athlete who had already
    dismissed it. This pins the safe direction.
  */
  it("emits no markup for any state, including one that will open on the client", () => {
    expect(renderToStaticMarkup(<TodaysSessionTakeover payload={payload()} />)).toBe("");
    expect(renderToStaticMarkup(<TodaysSessionTakeover payload={null} />)).toBe("");
    expect(
      renderToStaticMarkup(
        <TodaysSessionTakeover payload={payload({ status: "noPlan", days: undefined })} />
      )
    ).toBe("");
  });
});
