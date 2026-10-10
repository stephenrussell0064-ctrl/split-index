import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FileImport } from "@/components/activities/file-import";

/**
 * /cardio/import — a GPX, TCX or FIT file becomes a session.
 *
 * Phase 3 of the logging-effort plan. The gate here is the same as every
 * logging page: signed in and through onboarding. The import itself is
 * free on every tier (features.ts `file_import`); the API route checks that
 * too, so this page is a door, not a lock.
 */
export default async function CardioImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();
  if (!profile?.onboarding_completed) redirect("/onboarding");

  return <FileImport />;
}
