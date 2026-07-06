import type { PostgrestError } from "@supabase/supabase-js";

export function supabaseErrorMessage(
  fallback: string,
  error: PostgrestError | null | undefined
): string {
  if (!error) return fallback;

  if (process.env.NODE_ENV === "development") {
    console.error(fallback, error);
    const code = error.code ? ` [${error.code}]` : "";
    return `${fallback} (${error.message}${code})`;
  }

  return fallback;
}
