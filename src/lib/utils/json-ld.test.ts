import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonLdScript } from "./json-ld";
import { readNonTestSources } from "@/lib/testing/source-scan";

/**
 * L2 — structured data cannot close its own script tag.
 *
 * The HTML parser looks for the literal `</script` while reading a script
 * element and ends the element there, before any JSON parsing happens. So the
 * question is not "is this valid JSON" — `JSON.stringify` guarantees that — but
 * "can this string end the element it is inside", and those are different
 * problems with different escapes.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/*
 * Built from char codes rather than written literally. U+2028 and U+2029 ARE
 * line terminators, so a literal one inside a regex or string in this file
 * would break the parse — which is a neat demonstration of why they need
 * escaping in the first place, and was how the first version of json-ld.ts
 * failed to compile.
 */
const RAW_LINE_SEPARATOR = String.fromCharCode(0x2028);
const RAW_PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("escaping", () => {
  it("neutralises a closing script tag", () => {
    const out = jsonLdScript({ name: "</script><img src=x onerror=alert(1)>" });
    expect(out).not.toContain("</script");
    expect(out).toContain("\\u003c");
  });

  it("neutralises it however it is cased or spaced", () => {
    // The parser is case-insensitive and tolerates whitespace before the `>`.
    for (const payload of ["</SCRIPT>", "</ScRiPt >", "</script\n>"]) {
      const out = jsonLdScript({ name: payload });
      expect(out.toLowerCase(), payload).not.toContain("</script");
    }
  });

  it("escapes ampersands, so an entity cannot be reconstructed", () => {
    expect(jsonLdScript({ name: "a & b" })).toContain("\\u0026");
  });

  it("escapes the line and paragraph separators", () => {
    // Valid in JSON strings, historically invalid in JavaScript string
    // literals — which breaks any consumer that evaluates rather than parses.
    const out = jsonLdScript({ a: "x\u2028y", b: "x\u2029y" });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    // And the raw characters are gone — it is the literal separators in the
    // output that break a consumer, not their escaped spelling.
    expect(out).not.toContain(RAW_LINE_SEPARATOR);
    expect(out).not.toContain(RAW_PARAGRAPH_SEPARATOR);
  });

  /**
   * The property that makes this safe to apply everywhere: it changes the
   * REPRESENTATION and not the data. `<` is a valid JSON escape, so a
   * parser reads back the original character.
   */
  it("round-trips to exactly the original object", () => {
    const original = {
      "@context": "https://schema.org",
      name: "Split Index",
      tricky: `</script> & ${RAW_LINE_SEPARATOR}${RAW_PARAGRAPH_SEPARATOR} <b>`,
      nested: { list: [1, 2, "</script>"] },
    };
    expect(JSON.parse(jsonLdScript(original))).toEqual(original);
  });

  it("produces something a JSON parser accepts", () => {
    expect(() => JSON.parse(jsonLdScript({ a: 1 }))).not.toThrow();
  });
});

describe("no raw JSON.stringify reaches a script tag", () => {
  /**
   * The regression guard.
   *
   * Both current call sites pass static objects, so there is no live injection
   * path — which is the whole reason to fix it now. The day a username or a
   * race name enters one of those objects, the vulnerability arrives with it
   * and nothing about the change will look dangerous.
   */
  it("uses jsonLdScript for every dangerouslySetInnerHTML", () => {
    const offenders: string[] = [];

    /*
     * Comments stripped first. The first version flagged
     * src/lib/validation/boundary.ts, whose comment explains WHERE output
     * escaping is needed and names `dangerouslySetInnerHTML` to do it — the
     * fifth time in this codebase that a source scanner fired on its own
     * documentation. readNonTestSources exists so it is the last.
     */
    for (const { file, code } of readNonTestSources(join(ROOT, "src"))) {
      code.split("\n").forEach((line, i) => {
        if (!/dangerouslySetInnerHTML/.test(line)) return;
        // The safe form, and the one other legitimate shape: a literal string.
        if (/jsonLdScript\(/.test(line)) return;
        offenders.push(`${relative(ROOT, file)}:${i + 1}`);
      });
    }

    expect(
      offenders,
      "these set raw HTML — if it is structured data use jsonLdScript(), and if " +
        "it is anything else it needs its own escaping decision written down:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });
});
