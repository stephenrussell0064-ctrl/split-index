import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DurationInput, Field, GlassInput, HeroInput, UnitInput } from "./fields";

/**
 * EVERY INPUT NEEDS A NAME, AND NO TWO MAY SHARE AN id.
 *
 * `Field` has always accepted an `htmlFor` and not one of its 73 call sites
 * passed one, so the label was a floating paragraph beside an anonymous
 * `<input>`: VoiceOver announced every weight, rep, distance and duration field
 * in the app as "text field, blank". `Field` now generates the id itself.
 *
 * The risk that creates is the opposite one — a Field wrapping several inputs
 * handing them all the SAME id, which is a worse defect than the one being
 * fixed, because a duplicate id makes `htmlFor` resolve to whichever element
 * the browser happened to see first. The composites (duration, split, clock)
 * already name their own inputs, and that is exactly what makes them decline
 * the field's id. Both halves are asserted here.
 */

/** Every `id="..."` in the rendered markup, in order. */
function idsIn(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]!);
}

function labelTargetsIn(html: string): string[] {
  return [...html.matchAll(/\sfor="([^"]*)"/g)].map((m) => m[1]!);
}

describe("a single-input field is labelled", () => {
  it.each([
    ["GlassInput", <GlassInput key="a" value="" readOnly />],
    ["UnitInput", <UnitInput key="b" unit="kg" value="" readOnly />],
    ["HeroInput", <HeroInput key="c" unit="km" value="" readOnly />],
  ])("points its label at the %s inside it", (_name, input) => {
    const html = renderToStaticMarkup(<Field label="Distance">{input}</Field>);
    const [target] = labelTargetsIn(html);
    expect(target).toBeTruthy();
    expect(idsIn(html)).toContain(target);
  });

  it("lets an explicit htmlFor win, for callers that name their own field", () => {
    const html = renderToStaticMarkup(
      <Field label="Bodyweight" htmlFor="bodyweight-kg">
        <GlassInput id="bodyweight-kg" value="" readOnly />
      </Field>
    );
    expect(labelTargetsIn(html)).toEqual(["bodyweight-kg"]);
    expect(idsIn(html)).toEqual(["bodyweight-kg"]);
  });
});

describe("a multi-input field does not hand out the same id three times", () => {
  it("leaves the duration parts with their own names instead", () => {
    const html = renderToStaticMarkup(
      <Field label="Duration">
        <DurationInput hours="" minutes="45" seconds="00" onChange={() => {}} />
      </Field>
    );

    // Three inputs, each already named — so none of them adopts the field id,
    // and there are no ids to collide.
    const ids = idsIn(html);
    expect(new Set(ids).size).toBe(ids.length);

    for (const name of ["Duration hr", "Duration min", "Duration sec"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
  });

  it("keeps ids unique across two fields on the same screen", () => {
    // The other half of the id problem the audit found: 195 inputs sharing 29
    // ids, because ids were derived from label TEXT. Two "Weight" fields on one
    // page produced two elements called `weight`.
    const html = renderToStaticMarkup(
      <>
        <Field label="Weight">
          <GlassInput value="" readOnly />
        </Field>
        <Field label="Weight">
          <GlassInput value="" readOnly />
        </Field>
      </>
    );
    const ids = idsIn(html);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
    expect(labelTargetsIn(html)).toEqual(ids);
  });
});
