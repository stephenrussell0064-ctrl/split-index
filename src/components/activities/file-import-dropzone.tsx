"use client";

import { useCallback, useState } from "react";
import { CloudUpload, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export function FileImportDropzone({
  accept = ".gpx,.tcx,.fit,application/gpx+xml,application/tcx+xml",
  sport,
  compact = false,
  onImported,
}: {
  accept?: string;
  sport?: string;
  compact?: boolean;
  onImported?: (message: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setResult(null);
      const formData = new FormData();
      formData.append("file", file);
      if (sport) formData.append("sport", sport);

      try {
        const res = await fetch("/api/integrations/import/file", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        const message = data.message ?? data.error ?? (res.ok ? "Import complete" : "Import failed");
        setResult({ ok: res.ok, message });
        onImported?.(message);
      } catch {
        setResult({ ok: false, message: "Upload failed" });
      } finally {
        setUploading(false);
      }
    },
    [sport, onImported]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <div className={cn("space-y-2", compact && "text-sm")}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-xl text-center transition-colors",
          compact ? "p-4" : "p-6",
          dragOver
            ? "border-cardio-accent bg-cardio-accent/5"
            : "border-white/10 hover:border-cardio-border/40"
        )}
      >
        <CloudUpload className={cn("mx-auto text-muted mb-2", compact ? "h-6 w-6" : "h-8 w-8")} />
        <p className="text-sm font-medium">Drop GPX or TCX file</p>
        <p className="text-xs text-muted mt-1">FIT support coming soon</p>
        <label className="inline-block mt-3 cursor-pointer">
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="secondary" size="sm" loading={uploading} type="button">
            Browse files
          </Button>
        </label>
      </div>
      {result && (
        <p
          className={cn(
            "flex items-center gap-2 text-xs",
            result.ok ? "text-success" : "text-warning"
          )}
        >
          {result.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {result.message}
        </p>
      )}
    </div>
  );
}
