import { connection } from "next/server";
import GpsRunClient from "./gps-run-client";

/**
 * A server shell whose only job is to stop this page being prerendered (M9).
 *
 * `/cardio/gps-run` sits under a path prefix that receives the nonce-based CSP, and a
 * nonce exists only on a server-rendered request. Prerendered, this page's
 * script tags would be baked at build time carrying no nonce, and the browser
 * would refuse to run the page's own JavaScript — a blank screen, with nothing
 * in it to connect the failure to a header set in a proxy.
 *
 * `await connection()` is the documented way to say "wait for a request before
 * rendering this" (see the bundled Next docs, content-security-policy.md,
 * "Forcing dynamic rendering"). The route segment config `export const dynamic
 * = "force-dynamic"` was tried first and is NOT equivalent here: exported from
 * a "use client" module it is accepted silently and does nothing, and the build
 * output still showed this route as prerendered. Route segment config no longer
 * lists `dynamic` at all in Next 16.
 *
 * The cost is one server render per view of a page that already requires a
 * login. That is the whole trade the CSP split exists to make: pay it here,
 * not on the landing page.
 */
export default async function GpsRunClientPage() {
  await connection();
  return <GpsRunClient />;
}
