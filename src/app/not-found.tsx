import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { mainContentProps } from "@/lib/a11y/main-content";

export default function NotFound() {
  return (
    <main {...mainContentProps} className="min-h-dvh bg-ambient flex flex-col items-center justify-center px-6 text-center focus:outline-none">
      <BrandMark variant="compact" href="/" iconSize={36} className="mb-8" />
      <p className="micro-label text-muted mb-2">404</p>
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className={buttonVariants()}>Go to dashboard</Link>
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>Back to home</Link>
      </div>
    </main>
  );
}
