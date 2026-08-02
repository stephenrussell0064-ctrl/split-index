"use client";

import { useState } from "react";
import { CloudUpload, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

/**
 * Onboarding bootstrap step (SPLITINDEX-NEXT-STAGE-REPORT.md Section C) —
 * solves the Interference Radar's cold-start problem: a brand-new user
 * can't see anything from the flagship feature until MIN_PAIRED_SESSIONS
 * worth of live logging has accumulated, which could be weeks. Reuses the
 * existing CSV import pipeline (no new import functionality), just adds
 * this as a new entry point into it, placed right after the score reveal.
 */
export function CsvBootstrapStep({ onContinue }: { onContinue: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/integrations/import/csv", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not import that file. Please try again.");
      } else {
        setResult({
          imported: data.imported ?? 0,
          skipped: data.skipped ?? 0,
          failed: data.failed ?? 0,
        });
      }
    } catch {
      setError("Could not import that file. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="glass-strong text-center py-10 px-6 mb-6">
      <CloudUpload className="mx-auto mb-4 h-8 w-8 text-accent" />
      <h2 className="headline-tight text-xl font-bold mb-2">Have past training data?</h2>
      <p className="mx-auto mb-6 max-w-sm text-sm text-muted">
        Import a CSV export of your lifting and running history now — enough of both sides and
        we&apos;ll unlock your Interference Radar immediately, instead of making you wait weeks of
        live logging.
      </p>

      {result ? (
        <div className="flex items-center justify-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {result.imported} activities imported
          {result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}
          {result.failed > 0 ? ` · ${result.failed} failed` : ""}
        </div>
      ) : (
        <label className="inline-block cursor-pointer">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button loading={uploading} type="button">
            Choose CSV file
          </Button>
        </label>
      )}

      {error && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-8">
        <Button onClick={onContinue}>
          {result ? "Continue" : "Skip for now"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
