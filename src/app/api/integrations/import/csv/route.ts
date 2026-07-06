import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCsvContent, validateActivities } from "@/lib/integrations/csv-parser";
import { runImportJob } from "@/lib/integrations/import-pipeline";

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

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
    return NextResponse.json({ error: "File must be a .csv" }, { status: 400 });
  }

  const content = await file.text();
  const maxSize = 5 * 1024 * 1024;
  if (content.length > maxSize) {
    return NextResponse.json({ error: "CSV file exceeds 5MB limit" }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      user_id: user.id,
      source: "csv",
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

  await supabase
    .from("import_jobs")
    .update({ step: "parsing", status: "parsing", progress_pct: 5 })
    .eq("id", job.id);

  const parsed = parseCsvContent(content, file.name);

  if (parsed.activities.length === 0) {
    await supabase
      .from("import_jobs")
      .update({
        status: "failed",
        step: "done",
        errors: parsed.errors,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json(
      {
        jobId: job.id,
        error: "No valid activities found",
        parseErrors: parsed.errors,
      },
      { status: 400 }
    );
  }

  const validationErrors = validateActivities(parsed.activities);
  const allErrors = [...parsed.errors, ...validationErrors];

  await supabase
    .from("import_jobs")
    .update({
      step: "validating",
      status: "validating",
      progress_pct: 10,
      total: parsed.activities.length,
      errors: allErrors,
    })
    .eq("id", job.id);

  try {
    const result = await runImportJob(
      supabase,
      user.id,
      job.id,
      parsed.activities,
      "csv"
    );

    return NextResponse.json({
      jobId: job.id,
      step: "done",
      ...result,
      parseErrors: parsed.errors,
      message:
        result.skipped > 0
          ? `${result.imported} imported, ${result.skipped} skipped as duplicates`
          : `${result.imported} activities imported`,
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
