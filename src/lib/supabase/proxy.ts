import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Internal header carrying the VERIFIED user id from here to the rate limiter.
 *
 * Declared in this module rather than in proxy.ts so the dependency runs one
 * way: proxy.ts imports from here, and nothing here imports from proxy.ts.
 *
 * It never reaches the browser — proxy.ts deletes it once it has read the
 * value. It exists so the limiter can key by user without making a second
 * round trip to Supabase, and reading the id out of the cookie instead would
 * mean a forged cookie could spend another athlete's allowance.
 */
export const USER_ID_HEADER = "x-si-user";

/**
 * `NextResponse.next()` carrying extra headers on the REQUEST as well as the
 * response.
 *
 * Built fresh from `request.headers` at each call site rather than once up
 * front, because Supabase's `setAll` mutates the request's cookie header before
 * rebuilding the response — a headers object captured earlier would carry the
 * cookies from before the refresh and quietly sign the athlete out.
 *
 * The request side is not decoration: Next injects a CSP nonce into its own
 * script tags by reading the Content-Security-Policy header off the REQUEST
 * during server-side rendering. Set it only on the response and the header is
 * sent, the nonce is never applied to anything, and the browser blocks the
 * page's own JavaScript.
 */
function nextWithRequestHeaders(
  request: NextRequest,
  extra?: Record<string, string>
): NextResponse {
  if (!extra) return NextResponse.next({ request });

  const headers = new Headers(request.headers);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return NextResponse.next({ request: { headers } });
}

export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>
) {
  let supabaseResponse = nextWithRequestHeaders(request, extraRequestHeaders);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = nextWithRequestHeaders(request, extraRequestHeaders);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) supabaseResponse.headers.set(USER_ID_HEADER, user.id);

    const isAuthRoute =
      request.nextUrl.pathname.startsWith("/login") ||
      request.nextUrl.pathname.startsWith("/signup");
    const isPublicSocialProfile =
      request.nextUrl.pathname.startsWith("/social/profile/");
    const isAppRoute =
      request.nextUrl.pathname.startsWith("/dashboard") ||
      request.nextUrl.pathname.startsWith("/onboarding") ||
      request.nextUrl.pathname.startsWith("/activities") ||
      request.nextUrl.pathname.startsWith("/analytics") ||
      request.nextUrl.pathname.startsWith("/gym") ||
      request.nextUrl.pathname.startsWith("/cardio") ||
      (request.nextUrl.pathname.startsWith("/social") && !isPublicSocialProfile) ||
      request.nextUrl.pathname.startsWith("/settings") ||
      request.nextUrl.pathname.startsWith("/profile");

    if (!user && isAppRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    if (user && isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  } catch (error) {
    console.error("[proxy] Supabase session update failed:", error);
  }

  return supabaseResponse;
}
