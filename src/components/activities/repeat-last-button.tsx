"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RepeatLastButton({ logHref }: { logHref: string }) {
  const router = useRouter();

  return (
    <Button variant="secondary" size="sm" onClick={() => router.push(`${logHref}?repeat=1`)}>
      <RotateCcw className="h-4 w-4" />
      Repeat last
    </Button>
  );
}
