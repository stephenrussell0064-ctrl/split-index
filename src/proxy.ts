import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Best-effort per-instance limiter for our own API routes. Login/signup/
// password-reset go straight to Supabase Auth from the browser and are
// already rate-limited by GoTrue — this covers routes that had no
// throttling at all (activity logging, account deletion, etc).
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const UNTHROTTLED_API_PREFIXES = ["/api/stripe/webhook", "/api/cron", "/api/integrations/sync"];

const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) return false;
  if (UNTHROTTLED_API_PREFIXES.some((p) => pathname.startsWith(p))) return false;

  const ip = clientIp(request);
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  if (hits.size > 5000) {
    for (const [key, val] of hits) {
      if (now > val.resetAt) hits.delete(key);
    }
  }
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

export async function proxy(request: NextRequest) {
  if (isRateLimited(request)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
