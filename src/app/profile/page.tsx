import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileForm } from "@/components/profile/profile-form";
import type { Profile } from "@/types";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) redirect("/onboarding");

  const [{ data: latestIndex }, { count: activityCount }, { count: prCount }] =
    await Promise.all([
      supabase
        .from("split_index_history")
        .select("split_index, endurance_index, strength_index")
        .eq("user_id", user.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_draft", false),
      supabase
        .from("personal_records")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <ProfileHeader
          profile={profile as Profile}
          email={user.email ?? ""}
          splitIndex={latestIndex?.split_index ?? null}
          enduranceIndex={latestIndex?.endurance_index ?? null}
          strengthIndex={latestIndex?.strength_index ?? null}
          activityCount={activityCount ?? 0}
          prCount={prCount ?? 0}
        />
        <ProfileForm profile={profile as Profile} />
      </div>
    </AppShell>
  );
}
