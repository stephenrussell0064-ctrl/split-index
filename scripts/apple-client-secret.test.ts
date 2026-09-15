import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * The Supabase Apple provider's "Secret Key" field takes a JWT, not the .p8 —
 * and a token Apple dislikes comes back as `invalid_client`, with nothing to say
 * which of the four ways it was wrong. Sign in with Apple then fails in
 * production with no deploy and no error in our own logs, which is how it
 * reaches App Review rather than us.
 *
 * So the token's shape is pinned here. Every assertion below is a requirement
 * Apple enforces and would otherwise only be discoverable by being rejected:
 * the ES256 alg, the raw r||s signature (not DER), the six-month ceiling, and
 * the Services ID in `sub`.
 *
 * The key is generated per run and thrown away. No real Apple key is, or should
 * ever be, in this repository.
 */

const SCRIPT = resolve(__dirname, "apple-client-secret.mjs");
const KEY_ID = "TESTKEYID9";
const TEAM_ID = "PC423ABD82";
const SERVICES_ID = "co.uk.splitindex.app.signin";

let dir: string;
let p8Path: string;
let token: string;

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "apple-secret-"));
  p8Path = join(dir, "AuthKey_TESTKEYID9.p8");

  // Apple issues P-256 keys; generating one here keeps the test honest without
  // putting a real signing key anywhere near the repo.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(p8Path, privateKey.export({ type: "pkcs8", format: "pem" }).toString());

  token = execFileSync(
    process.execPath,
    [SCRIPT, "--p8", p8Path, "--key-id", KEY_ID, "--team-id", TEAM_ID, "--services-id", SERVICES_ID],
    { encoding: "utf8" },
  ).trim();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the generated client secret is a token Apple will accept", () => {
  it("is a three-part JWT", () => {
    expect(token.split(".")).toHaveLength(3);
  });

  it("declares ES256 and the key id", () => {
    // Apple accepts no other algorithm for this token, and needs the kid to
    // know which of your keys signed it.
    expect(decode(token.split(".")[0])).toEqual({ alg: "ES256", kid: KEY_ID });
  });

  it("carries the team as issuer and Apple as audience", () => {
    const payload = decode(token.split(".")[1]);
    expect(payload.iss).toBe(TEAM_ID);
    expect(payload.aud).toBe("https://appleid.apple.com");
  });

  it("puts the Services ID in sub, not the bundle id", () => {
    // The single most common misconfiguration: `sub` must be the Services ID
    // created for the web flow. The bundle id here authenticates as nothing.
    const payload = decode(token.split(".")[1]);
    expect(payload.sub).toBe(SERVICES_ID);
    expect(payload.sub).not.toBe("co.uk.splitindex.app");
  });

  it("expires inside Apple's six-month ceiling", () => {
    const payload = decode(token.split(".")[1]) as { iat: number; exp: number };
    const lifetime = payload.exp - payload.iat;
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(15777000);
  });

  it("signs with a raw r||s signature rather than DER", () => {
    // OpenSSL's default is a DER envelope of variable length; JOSE requires the
    // bare 64-byte pair. A DER signature yields `invalid_client` from Apple.
    const sig = Buffer.from(
      token.split(".")[2].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
    expect(sig).toHaveLength(64);
  });

  it("verifies against the key that signed it", () => {
    const [header, payload, signature] = token.split(".");
    const pub = createPublicKey(createPrivateKey({ key: readKey(), format: "pem" }));
    const ok = createVerify("SHA256")
      .update(`${header}.${payload}`)
      .verify(
        { key: pub, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
      );
    expect(ok).toBe(true);
  });
});

describe("it refuses input it cannot sign with", () => {
  it("exits non-zero when a required argument is missing", () => {
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, "--p8", p8Path, "--key-id", KEY_ID], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("rejects an RSA key rather than emitting a token Apple will refuse", () => {
    const rsaPath = join(dir, "rsa.p8");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(rsaPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString());

    expect(() =>
      execFileSync(
        process.execPath,
        [SCRIPT, "--p8", rsaPath, "--key-id", KEY_ID, "--team-id", TEAM_ID, "--services-id", SERVICES_ID],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow();
  });
});

function readKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(p8Path, "utf8");
}
