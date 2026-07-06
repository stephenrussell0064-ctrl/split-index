export { parseGpxContent } from "./gpx";
export { parseTcxContent } from "./tcx";
export { parseFitContent, isFitFile } from "./fit";

export type FileFormat = "gpx" | "tcx" | "fit" | "unknown";

export function detectFileFormat(filename: string, contentType?: string): FileFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gpx") || contentType?.includes("gpx")) return "gpx";
  if (lower.endsWith(".tcx") || contentType?.includes("tcx")) return "tcx";
  if (lower.endsWith(".fit")) return "fit";
  return "unknown";
}
