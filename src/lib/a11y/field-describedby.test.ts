import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fieldDescribedBy, fieldInvalid } from "./field-describedby";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * N7 item 3 — form errors are tied to their field.
 *
 * The finding, verified twice before this fix: `role="alert"` was present on
 * every error, and `aria-describedby`, `aria-errormessage` and `aria-invalid`
 * appeared nowhere in `src/components/ui`. A live region announces an error
 * when it appears and says nothing on the way back to the field.
 *
 * The merging logic below is the part with real failure modes, so it is an
 * ordinary function and gets ordinary tests. The wiring is checked by reading
 * the component source, which is weaker and is labelled as such — this project
 * has no React testing library.
 */

describe("fieldDescribedBy", () => {
  const ids = { hintId: "f-hint", errorId: "f-error" };

  it("points at the error when there is one", () => {
    expect(fieldDescribedBy({ ...ids, hasError: true })).toBe("f-error");
  });

  it("points at the hint when there is no error", () => {
    expect(fieldDescribedBy({ ...ids, hasHint: true })).toBe("f-hint");
  });

  /**
   * The components render the hint OR the error, never both. Referencing the
   * hint while it is unmounted is a dangling reference, and a dangling
   * reference is how `aria-describedby` announces nothing at all.
   */
  it("drops the hint while an error is showing, because the hint is unmounted", () => {
    expect(fieldDescribedBy({ ...ids, hasHint: true, hasError: true })).toBe("f-error");
  });

  /**
   * A field may already be described by something this component knows nothing
   * about — a shared unit note, a character counter. Overwriting it would close
   * this finding by creating a quieter version of it.
   */
  it("keeps what the caller already pointed at, and reads it first", () => {
    expect(
      fieldDescribedBy({ ...ids, caller: "units-note", hasError: true })
    ).toBe("units-note f-error");
    expect(
      fieldDescribedBy({ ...ids, caller: "units-note", hasHint: true })
    ).toBe("units-note f-hint");
  });

  /**
   * `aria-describedby=""` is not the same as omitting it. It is a reference to
   * an element with no id, and some screen readers announce that failure.
   */
  it("is undefined, not empty, when there is nothing to point at", () => {
    expect(fieldDescribedBy({ ...ids })).toBeUndefined();
    expect(fieldDescribedBy({})).toBeUndefined();
    expect(fieldDescribedBy({ caller: "   ", ...ids })).toBeUndefined();
  });
});

describe("fieldInvalid", () => {
  it("marks an errored field invalid", () => {
    expect(fieldInvalid(true)).toBe(true);
  });

  /**
   * Not `false`. `aria-invalid="false"` is a claim that the field has been
   * judged and passed; a field nobody has reached yet has not been judged.
   */
  it("says nothing about a field with no error", () => {
    expect(fieldInvalid(false)).toBeUndefined();
  });
});

describe("the three form controls are wired to it", () => {
  /**
   * Source assertions, and weaker than the ones above — they prove the
   * attributes are written, not that they resolve to a rendered node. There is
   * no React testing library here, which is why the logic worth testing was
   * moved out of the component in the first place.
   *
   * Comments stripped before matching: this file and input.tsx both explain
   * `aria-errormessage` in order to say why it is not used, and a scanner that
   * reads prose would find the thing it is checking for the absence of. That
   * mistake has now been made six times in this repository.
   */
  const source = stripComments(
    readFileSync(
      fileURLToPath(new URL("../../components/ui/input.tsx", import.meta.url)),
      "utf8"
    )
  );

  it.each(["Input", "Select", "Textarea"])(
    "%s sets aria-invalid and aria-describedby from the helper",
    (component) => {
      const start = source.indexOf(`export function ${component}(`);
      expect(start, `${component} not found`).toBeGreaterThan(-1);
      const next = ["Input", "Select", "Textarea"]
        .map((c) => source.indexOf(`export function ${c}(`))
        .filter((i) => i > start);
      const body = source.slice(start, next.length ? Math.min(...next) : undefined);

      expect(body).toContain("aria-invalid={fieldInvalid(");
      expect(body).toContain("aria-describedby={fieldDescribedBy(");
    }
  );

  it("gives every error node an id for that reference to land on", () => {
    // Three controls, three error slots. A role="alert" without an id is the
    // state this finding described.
    expect(source.match(/role="alert"/g)?.length).toBe(3);
    expect(source.match(/id=\{errorId\}/g)?.length).toBe(3);
  });

  it("gives the hint an id too, since Input points at it", () => {
    expect(source).toContain("id={hintId}");
  });

  /**
   * The regression that would undo this quietly: reinstating the plain spread
   * signature, so a caller's own aria-describedby lands in `...props` and
   * overwrites the merged one instead of being merged into it.
   */
  it("destructures the caller's aria-describedby rather than spreading it", () => {
    expect(source.match(/"aria-describedby": describedBy/g)?.length).toBe(3);
  });
});

describe("the activity form's Field wires its error the same way", () => {
  /**
   * `Field` is the other half of item 3 and the larger half: 78 call sites
   * against the three controls in components/ui. Its inputs did carry
   * `aria-invalid`, so the field was announced as rejected — with no way to
   * reach the reason.
   */
  const source = stripComments(
    readFileSync(
      fileURLToPath(new URL("../../components/activities/fields.tsx", import.meta.url)),
      "utf8"
    )
  );

  it("gives the error message an id and points Field at it", () => {
    expect(source).toContain("const errorId = `${id}-error`");
    expect(source).toContain("<FieldError error={error} id={errorId} />");
  });

  it("renders that id on the alert node", () => {
    const start = source.indexOf("export function FieldError(");
    const body = source.slice(start, start + 600);
    expect(body).toContain("id={id}");
    expect(body).toContain('role="alert"');
  });

  it("hands the reference to every input inside the field", () => {
    // GlassInput, UnitInput, HeroInput — the three that adopt the Field's id.
    expect(source.match(/const errorProps = useFieldErrorProps\(\);/g)?.length).toBe(3);
    expect(source.match(/\{\.\.\.errorProps\}/g)?.length).toBe(3);
  });

  /**
   * The rule that differs from `useFieldId`, and the one most likely to be
   * "corrected" by someone who reads only that one. A self-labelled input must
   * not adopt the Field's id — duplicate ids — but it MUST be able to point at
   * the Field's error, because DurationInput's three boxes are all rejected by
   * the same message. aria-describedby is a reference, not an identifier.
   */
  it("does not exclude self-labelled inputs from the error reference", () => {
    const start = source.indexOf("function useFieldErrorProps(");
    const body = source.slice(start, source.indexOf("}", source.indexOf("return { \"aria-invalid\"", start)));
    expect(body).not.toContain("aria-label");
  });

  it("says nothing when there is no error", () => {
    // aria-invalid="false" claims the field was checked; aria-describedby=""
    // is a reference to nothing.
    expect(source).toContain("if (!ctx?.hasError) return {};");
  });
});
