import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  detectFileFormat,
  parseGpxContent,
  parseTcxContent,
  parseFitContent,
  isFitFile,
} from "@/lib/integrations/parsers";
import { validateActivities } from "@/lib/integrations/csv-parser";
import { runImportJob } from "@/lib/integrations/import-pipeline";
import type { ExternalActivity } from "@/lib/integrations/types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const sportOverride = formData.get("sport")?.toString();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 400 });
  }

  const format = detectFileFormat(file.name, file.type);

  if (format === "unknown" && !isFitFile(file.name, file.type)) {
    return NextResponse.json(
      { error: "Unsupported format. Use GPX, TCX, or FIT." },
      { status: 400 }
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      user_id: user.id,
      source: "file",
      status: "parsing",
      step: "parsing",
      progress_pct: 0,
    })
    .select()
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: jobError?.message ?? "Failed to create import job" },
      { status: 500 }
    );
  }

  let activities: ExternalActivity[] = [];
  const parseErrors: { message: string; row?: number }[] = [];
  let fitStubMessage: string | undefined;

  try {
    if (format === "gpx" || file.name.toLowerCase().endsWith(".gpx")) {
      const content = await file.text();
      const parsed = parseGpxContent(content, file.name);
      activities = parsed.activities;
      parseErrors.push(...parsed.errors);
    } else if (format === "tcx" || file.name.toLowerCase().endsWith(".tcx")) {
      const content = await file.text();
      const parsed = parseTcxContent(content, file.name);
      activities = parsed.activities;
      parseErrors.push(...parsed.errors);
    } else if (isFitFile(file.name, file.type)) {
      const buffer = await file.arrayBuffer();
      const fitResult = parseFitContent(buffer, file.name);
      fitStubMessage = fitResult.message;
      parseErrors.push({ message: fitResult.message });
    }
  } catch (err) {
    await supabase
      .from("import_jobs")
      .update({
        status: "failed",
        step: "done",
        errors: [{ message: err instanceof Error ? err.message : "Parse failed" }],
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse failed", jobId: job.id },
      { status: 400 }
    );
  }

  if (fitStubMessage) {
    await supabase
      .from("import_jobs")
      .update({
        status: "failed",
        step: "done",
        errors: [{ message: fitStubMessage }],
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json(
      { error: fitStubMessage, jobId: job.id, format: "fit", stub: true },
      { status: 422 }
    );
  }

  if (sportOverride && activities.length > 0) {
    activities = activities.map((a) => ({
      ...a,
      sport: sportOverride as ExternalActivity["sport"],
    }));
  }

  if (activities.length === 0) {
    await supabase
      .from("import_jobs")
      .update({
        status: "failed",
        step: "done",
        errors: parseErrors,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json(
      { jobId: job.id, error: "No valid activities found", parseErrors },
      { status: 400 }
    );
  }

  const validationErrors = validateActivities(activities);

  await supabase
    .from("import_jobs")
    .update({
      step: "validating",
      status: "validating",
      progress_pct: 10,
      total: activities.length,
      errors: [...parseErrors, ...validationErrors],
    })
    .eq("id", job.id);

  try {
    const result = await runImportJob(supabase, user.id, job.id, activities, "file");

    return NextResponse.json({
      jobId: job.id,
      step: "done",
      format,
      ...result,
      parseErrors,
      message:
        result.skipped > 0
          ? `${result.imported} imported, ${result.skipped} skipped as duplicates`
          : `${result.imported} activities imported from ${format.toUpperCase()}`,
    });
  } catch (err) {
    await supabase
      .from("import_jobs")
      .update({
        status: "failed",
        step: "done",
        errors: [{ message: err instanceof Error ? err.message : "Import failed" }],
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed", jobId: job.id },
      { status: 500 }
    );
  }
}
