"use client";

import { useSyncExternalStore } from "react";
import { isNativePlatform } from "./platform";

/*
 * Capacitor's global does not exist during the server render, so the server has
 * to say "not native" and the client has to be free to disagree without that
 * counting as a hydration mismatch. `useSyncExternalStore` is the API for
 * exactly that: separate server and client snapshots of a value React does not
 * own. The alternative — setState in an effect — is what the React 19 lint rule
 * forbids, and it renders one answer and then the other on every web page load.
 *
 * `subscribe` registers nothing because the answer cannot change: an app does
 * not stop being an app while it is running. It is declared at module scope
 * because useSyncExternalStore re-subscribes whenever that reference changes,
 * and an inline arrow is a new reference on every render.
 *
 * Extracted from components/pricing/manage-subscription.tsx, which worked this
 * out first for the native paywall; the legal pages needed the same answer and
 * a second hand-rolled copy is how the two drift apart.
 */
const subscribeToNothing = () => () => {};

/** True only inside the Capacitor shell. False on the server and on the web. */
export function useIsNativeShell(): boolean {
  return useSyncExternalStore(subscribeToNothing, isNativePlatform, () => false);
}
