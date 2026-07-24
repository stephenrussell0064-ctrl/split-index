import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Email confirmed — Split Index",
};

export default function EmailConfirmedPage() {
  return (
    <div className="min-h-dvh bg-ambient flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <BrandMark variant="full" href="/" logoHeight={36} priority />
        </div>

        <div className="glass-strong rounded-2xl border border-white/[0.08] p-8">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 border border-accent/25">
            <CheckCircle2 className="h-7 w-7 text-accent" />
          </div>

          <h1 className="text-xl font-semibold text-foreground">
            You&apos;re verified — welcome to Split Index
          </h1>
          <p className="mt-2 text-sm text-muted">
            Your email is confirmed and your account is now active. Sign in to start
            logging your training and see where you rank.
          </p>

          <Link href="/login" className="mt-6 block">
            <Button className="w-full">Sign in to Split Index</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
