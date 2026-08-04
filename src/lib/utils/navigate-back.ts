import type { useRouter } from "next/navigation";

/**
 * Shared "go back" logic for both the top-bar BackButton and the edge-swipe
 * gesture (app-shell.tsx) — a direct link/deep-link into a sub-page (shared
 * URL, browser refresh) has no in-app history to go back to, so
 * `router.back()` alone would just leave the app/close the tab.
 * `window.history.length > 1` means this tab has somewhere real to return
 * to; otherwise fall back to the dashboard.
 */
export function navigateBack(router: ReturnType<typeof useRouter>): void {
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
  } else {
    router.push("/dashboard");
  }
}
