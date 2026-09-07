/**
 * Serialise structured data for a `<script type="application/ld+json">` block.
 *
 * WHY THIS IS NOT JUST JSON.stringify
 * -----------------------------------
 * `JSON.stringify` escapes what JSON needs escaped. It does not escape what
 * HTML needs escaped, and the two are different problems.
 *
 * The browser's HTML parser looks for the literal characters `</script` while
 * reading a script element and ends the element there, before any JavaScript or
 * JSON parsing happens. So a string containing `</script><img onerror=…>`
 * survives `JSON.stringify` intact, closes the tag early, and the rest is
 * parsed as markup.
 *
 * Today both call sites pass static objects with no user input, so there is no
 * live injection path — which is exactly why this is worth fixing now rather
 * than later: the moment a username, a race name or a squad title enters one of
 * those objects, the vulnerability arrives with it and nothing about the change
 * will look dangerous.
 *
 * `<` is escaped as `<` and `&` as `&`. Both are valid JSON string
 * escapes, so `JSON.parse` — which is what consumes this — reads them back as
 * the original characters. The structured data is unchanged; only its
 * representation inside the HTML document is.
 *
 * `U+2028` and `U+2029` are escaped for a different reason: they are valid in
 * JSON strings and were historically invalid in JavaScript string literals,
 * which breaks any consumer that evaluates rather than parses.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
