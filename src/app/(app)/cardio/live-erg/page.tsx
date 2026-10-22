import { connection } from "next/server";
import LiveErgClient from "./live-erg-client";

/**
 * A server shell whose only job is to stop this page being prerendered —
 * the same reason as /cardio/gps-run: this path receives the nonce-based
 * CSP, and a nonce exists only on a server-rendered request.
 */
export default async function LiveErgPage() {
  await connection();
  return <LiveErgClient />;
}
