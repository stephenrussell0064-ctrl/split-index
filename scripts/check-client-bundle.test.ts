import { describe, expect, it } from "vitest";
// Imported from the plain .mjs build script, so the gate and the test cannot
// drift into two copies of the same matching logic.
import { findSecrets } from "./check-client-bundle.mjs";

/**
 * WP2 — the build gate that stops a server key reaching the browser.
 *
 * The end-to-end proof is a real `next build` with a key planted in a client
 * component, which is recorded in the commit message. This covers the
 * discrimination the scanner has to get right, quickly enough to run on every
 * push, because the way this gate fails in practice is not "it never fires" —
 * it is "it fires on the anon key, someone disables it, and then it never
 * fires".
 */

/** A JWT with the given payload. Signature is not checked and does not matter. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlc2lnbmF0dXJl`;
}

const ANON_KEY = jwt({ iss: "supabase", ref: "abcdefghijklmnop", role: "anon", iat: 1, exp: 2 });
const SERVICE_KEY = jwt({
  iss: "supabase",
  ref: "abcdefghijklmnop",
  role: "service_role",
  iat: 1,
  exp: 2,
});

describe("what must fail the build", () => {
  it("catches a Supabase service_role JWT", () => {
    const findings = findSecrets(`const k="${SERVICE_KEY}";`, "chunk.js");
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toContain("service_role");
  });

  it("catches a service_role key hidden among ordinary minified code", () => {
    // What it actually looks like: inlined into a chunk, no whitespace, no
    // helpful variable name.
    const chunk = `(self.webpackChunk=self.webpackChunk||[]).push([[1],{42:e=>{e.exports="${SERVICE_KEY}"}}]);`;
    expect(findSecrets(chunk, "chunk.js")).toHaveLength(1);
  });

  it.each([
    ["Stripe live secret", "sk_live_" + "0".repeat(24)],
    ["Stripe test secret", "sk_test_" + "0".repeat(24)],
    ["Stripe webhook secret", "whsec_abcdefghijklmnopqrstuvwxyz012345"],
    ["OpenAI key", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"],
  ])("catches a %s", (_label, secret) => {
    expect(findSecrets(`x="${secret}"`, "chunk.js").length).toBeGreaterThan(0);
  });

  it("catches a secret env var being READ from a client chunk", () => {
    // `process.env.X` surviving into a client chunk means a server module was
    // bundled for the browser. Both access forms.
    expect(
      findSecrets("process.env.SUPABASE_SERVICE_ROLE_KEY", "chunk.js").length
    ).toBeGreaterThan(0);
    expect(
      findSecrets('process.env["STRIPE_SECRET_KEY"]', "chunk.js").length
    ).toBeGreaterThan(0);
  });

  it("catches a private key block", () => {
    expect(
      findSecrets("-----BEGIN PRIVATE KEY-----\\nMIIEv...", "chunk.js").length
    ).toBeGreaterThan(0);
  });

  it("never prints the secret it found", () => {
    // A CI log is not a safe place to put the thing you are complaining about
    // being in an unsafe place.
    const findings = findSecrets(`k="${SERVICE_KEY}"`, "chunk.js");
    const printed = JSON.stringify(findings);
    expect(printed).not.toContain(SERVICE_KEY);
    expect(printed).not.toContain(SERVICE_KEY.split(".")[1]);
  });
});

describe("what must NOT fail the build", () => {
  /**
   * The one that decides whether this gate survives contact with the team.
   * The anon key and the service-role key are both JWTs signed the same way,
   * so they share a byte-identical header. A prefix match would fail every
   * build of a correctly configured app.
   */
  it("passes the Supabase anon key, which belongs in the bundle", () => {
    expect(findSecrets(`const k="${ANON_KEY}";`, "chunk.js")).toEqual([]);
  });

  it("passes the anon key and a service key together by flagging only the second", () => {
    const findings = findSecrets(`a="${ANON_KEY}";b="${SERVICE_KEY}";`, "chunk.js");
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toContain("service_role");
  });

  it("passes a Stripe publishable key", () => {
    expect(findSecrets('k="pk_live_51Qabcdefghijklmnopqrstuvw"', "chunk.js")).toEqual([]);
  });

  it("passes the public env vars", () => {
    expect(
      findSecrets(
        "process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        "chunk.js"
      )
    ).toEqual([]);
  });

  /**
   * The regression that matters most, because it is the one that gets the gate
   * switched off. Three real client chunks contain "Stripe not configured. Add
   * STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local" — an operator help
   * message. The first version of the scanner matched the bare name and failed
   * a clean build on it.
   */
  it("passes an error message that merely names a secret env var", () => {
    const realChunkText =
      'return{ok:!1,message:s.error??"Stripe not configured. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local"}';
    expect(findSecrets(realChunkText, "chunk.js")).toEqual([]);
  });

  it("passes documentation prose naming every secret variable", () => {
    const prose = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "OPENAI_API_KEY",
      "CRON_SECRET",
    ].join(", ");
    expect(findSecrets(`"Set ${prose} in your environment"`, "chunk.js")).toEqual([]);
  });

  it("passes minified code that merely looks key-shaped", () => {
    // `sk` as a minified identifier, base64 that is not a JWT, and a `pk_`
    // string are all ordinary bundle content.
    const chunk = 'var sk=1,rk_=2;e.b64="eyJhIjoxfQ";var x="sk_"+t;';
    expect(findSecrets(chunk, "chunk.js")).toEqual([]);
  });

  it("does not choke on a JWT-shaped string that is not a JWT", () => {
    expect(() =>
      findSecrets("eyJnotbase64!!!.morerubbish!!!.stillrubbish!!!", "chunk.js")
    ).not.toThrow();
  });
});
