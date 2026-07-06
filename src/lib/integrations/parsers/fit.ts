import type { ImportRowError } from "../types";

export interface FitParseResult {
  activities: never[];
  errors: ImportRowError[];
  stub: true;
  message: string;
}

/**
 * FIT binary parsing deferred to Phase 2.5 — requires dedicated binary decoder.
 * Returns a clear user-facing message; GPX/TCX cover most export workflows.
 */
export function parseFitContent(_content: ArrayBuffer, filename = "upload.fit"): FitParseResult {
  void filename;
  return {
    activities: [],
    errors: [],
    stub: true,
    message:
      "FIT file support coming in Phase 2.5. Export as GPX or TCX from your device app, or use CSV import.",
  };
}

export function isFitFile(filename: string, mimeType?: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".fit") || mimeType === "application/vnd.ant.fit";
}
