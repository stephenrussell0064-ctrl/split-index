import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileView } from "@/components/social/profile-view";
import { fetchPublicProfile } from "@/lib/social/queries";

interface PageProps {
  params: Promise<{ username: string }>;
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const supabase = await createClient();

  const profile = await fetchPublicProfile(supabase, username);

  if (!profile) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <ProfileView profile={profile} isOwnProfile={user?.id === profile.userId} />
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { username } = await params;
  return {
    title: `@${username} · Split Index`,
    description: `View ${username}'s hybrid fitness profile on Split Index`,
  };
}
