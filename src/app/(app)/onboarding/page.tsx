import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { providerDisplayName } from "@/lib/supabase/ensure-profile";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { firstNameFrom } from "@/components/onboarding/onboarding-state";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, display_name")
    .eq("user_id", user.id)
    .single();

  if (profile?.onboarding_completed) redirect("/dashboard");

  /*
    The name to greet them by. Sign in with Apple hands the full name to
    Supabase on the FIRST authorisation only, as `full_name` in the user
    metadata; the signup trigger copies it into profiles.display_name. Read
    both, metadata first, so a greeting works even if the trigger ran before
    the metadata landed. An email/password signup has neither and gets
    "Welcome." — never the address.
  */
  const providerName =
    providerDisplayName(user) ??
    (typeof profile?.display_name === "string" && !profile.display_name.includes("@")
      ? profile.display_name
      : null);

  return (
    <OnboardingFlow
      firstName={firstNameFrom(providerName)}
      providerName={providerName}
      email={user.email ?? null}
    />
  );
}
