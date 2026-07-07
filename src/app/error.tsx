"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-ambient flex flex-col items-center justify-center px-6 text-center">
      <p className="micro-label text-muted mb-2">Something went wrong</p>
      <h1 className="text-2xl font-bold tracking-tight">We hit an error</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        A temporary problem prevented this page from loading. Try again, or head back
        to your dashboard.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard">
          <Button variant="secondary">Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
