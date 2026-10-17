import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPORTS,
  buildProfilePayload,
  buildSteps,
  emptyForm,
  firstNameFrom,
  nextUsernameCandidate,
  pickDefaultAvatar,
  suggestUsername,
  validateAbout,
} from "./onboarding-state";
import { validateUsernameFormat } from "@/lib/utils/username";

const NOW = new Date("2026-10-17T12:00:00Z");

/*
 * The rule the redesign hangs on: Continue always works. These pin the
 * defaults that make that true, and the one requirement that remains.
 */
describe("Continue with nothing typed produces a working profile", () => {
  it("saves nulls for every measurement the athlete skipped", () => {
    const payload = buildProfilePayload({
      userId: "u1",
      form: emptyForm({ username: "stephen" }),
      providerName: null,
      now: NOW,
    });
    expect(payload).toMatchObject({
      user_id: "u1",
      username: "stephen",
      date_of_birth: null,
      age: null,
      gender: null,
      scoring_basis: null,
      height_cm: null,
      weight_kg: null,
      max_hr: null,
      resting_hr: null,
      onboarding_completed: true,
    });
  });

  it("preselects gym and running, and falls back to them if everything is deselected", () => {
    expect(emptyForm().preferred_sports).toEqual(["gym", "running"]);
    const payload = buildProfilePayload({
      userId: "u1",
      form: emptyForm({ username: "a_b", preferred_sports: [] }),
      providerName: null,
    });
    expect(payload.preferred_sports).toEqual([...DEFAULT_SPORTS]);
  });

  it("validates only the fields that were filled in", () => {
    expect(validateAbout(emptyForm(), NOW)).toEqual({});
    expect(validateAbout(emptyForm({ weight_kg: "12" }), NOW)).toHaveProperty("weight_kg");
    expect(validateAbout(emptyForm({ date_of_birth: "2020-01-01" }), NOW)).toHaveProperty("date_of_birth");
    expect(validateAbout(emptyForm({ date_of_birth: "1990-06-15", height_cm: "180" }), NOW)).toEqual({});
  });

  it("picks a preset avatar so skipping leaves no blank circle — the same one on server and client", () => {
    expect(pickDefaultAvatar(["a", "b", "c"], "stephen@example.com")).toBe(
      pickDefaultAvatar(["a", "b", "c"], "stephen@example.com")
    );
    expect(["a", "b", "c"]).toContain(pickDefaultAvatar(["a", "b", "c"], "x"));
    expect(pickDefaultAvatar([], "x")).toBeNull();
  });
});

describe("the steps", () => {
  it("are four, with no Apple Health step until that is integrated end to end", () => {
    expect(buildSteps()).toEqual(["welcome", "about", "sports", "done"]);
  });
});

describe("the greeting name", () => {
  it("is the first word of the provider's full name", () => {
    expect(firstNameFrom("Stephen Russell")).toBe("Stephen");
    expect(firstNameFrom("  Ada ")).toBe("Ada");
  });

  it("is never an email address and never a reserved word", () => {
    expect(firstNameFrom("stephen@example.com")).toBeNull();
    expect(firstNameFrom("Admin")).toBeNull();
    expect(firstNameFrom(null)).toBeNull();
    expect(firstNameFrom("")).toBeNull();
  });
});

describe("the suggested username", () => {
  const fixed = () => 0.42;

  it("comes from the first name when there is one", () => {
    expect(suggestUsername({ name: "Stephen Russell", email: "x@y.com", random: fixed })).toBe("stephen");
  });

  it("falls back to the email's local part, folded to the allowed alphabet, trailing digits dropped", () => {
    expect(suggestUsername({ name: null, email: "stephen.russell0064@gmail.com", random: fixed })).toBe(
      "stephenrussell"
    );
  });

  it("never starts with a digit and is never shorter than three characters", () => {
    expect(suggestUsername({ name: null, email: "99@x.com", random: fixed })).toMatch(/^[a-z]/);
    expect(suggestUsername({ name: "Al", email: null, random: fixed })).toHaveLength(3);
    expect(suggestUsername({ name: null, email: null, random: fixed })).toBe("athlete");
  });

  it("always passes the format check the server applies", () => {
    for (const email of ["a@b.c", "___@x.com", "élodie.b@x.fr", "admin@x.com", "verylongemailaddresslocalpart@x.com"]) {
      const candidate = suggestUsername({ name: null, email, random: fixed });
      expect(validateUsernameFormat(candidate).valid, candidate).toBe(true);
    }
  });

  it("adds digits when the name is taken, and never exceeds twenty characters", () => {
    expect(nextUsernameCandidate("stephen", 0, fixed)).toBe("stephen_44");
    expect(nextUsernameCandidate("stephen_44", 1, fixed)).toBe("stephen_4444");
    const long = nextUsernameCandidate("abcdefghijklmnopqrst", 2, fixed);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(validateUsernameFormat(long).valid).toBe(true);
  });
});

describe("the profile row", () => {
  it("derives age and an estimated max HR when a date of birth was given", () => {
    const payload = buildProfilePayload({
      userId: "u1",
      form: emptyForm({ username: "x_y", date_of_birth: "1996-10-17" }),
      providerName: null,
      now: NOW,
    });
    expect(payload.age).toBe(30);
    expect(payload.max_hr).toBe(190);
  });

  it("lets a typed max HR win over the estimate", () => {
    const payload = buildProfilePayload({
      userId: "u1",
      form: emptyForm({ username: "x_y", date_of_birth: "1996-10-17", max_hr: "201" }),
      providerName: null,
      now: NOW,
    });
    expect(payload.max_hr).toBe(201);
  });

  it("answers the scoring basis from gender when it can, else from the explicit choice", () => {
    const male = buildProfilePayload({ userId: "u", form: emptyForm({ username: "abc", gender: "male" }), providerName: null });
    expect(male.scoring_basis).toBe("male");
    const other = buildProfilePayload({
      userId: "u",
      form: emptyForm({ username: "abc", gender: "other", scoring_basis: "female" }),
      providerName: null,
    });
    expect(other.scoring_basis).toBe("female");
    const unsaid = buildProfilePayload({ userId: "u", form: emptyForm({ username: "abc", gender: "prefer_not_to_say" }), providerName: null });
    expect(unsaid.scoring_basis).toBeNull();
  });

  it("never writes an email address as the display name", () => {
    const payload = buildProfilePayload({
      userId: "u",
      form: emptyForm({ username: "abc" }),
      providerName: "stephen@example.com",
    });
    expect(payload.display_name).toBeNull();
    const named = buildProfilePayload({ userId: "u", form: emptyForm({ username: "abc" }), providerName: " Stephen Russell " });
    expect(named.display_name).toBe("Stephen Russell");
  });
});
