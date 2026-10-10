import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessProfile } from "@/lib/premium/features";
import { detectImportFileKind, parseWorkoutFile, toImportPreview } from "@/lib/import/parsers";

/**
 * POST /api/activities/import — read a GPX, TCX or FIT file and answer with
 * what it would become, for the athlete to confirm.
 *
 * Nothing is written here. The response is a preview: the scored fields,
 * the route and the streams, plus the two things only the server can know
 * — whether this exact file has been imported before, and whether a session
 * of the same sport already sits within ten minutes of its start. The page
 * shows that, lets the athlete pick a sport where the file did not say, and
 * then posts to POST /api/activities like any other save, carrying a
 * `client_request_id` derived from the file's hash so the same file cannot
 * be filed twice however many times it is uploaded.
 *
 * Bounded on purpose:
 *  - 25 MB of file, which is a very long GPX; a FIT of the same session is
 *    a tenth of that.
 *  - Sessions dated within the last 90 days and not in the future. A year
 *    of history in one afternoon would reshape ACWR and the recovery
 *    baseline overnight (the plan's "baseline shock" risk); bulk history is
 *    a later, deliberate feature with its own handling.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_AGE_DAYS = 90;
const FUTURE_GRACE_MS = 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** Deterministic per file content, so a re-upload is the same request. Under the route's 100-character cap. */
export function fileClientRequestId(bytes: Uint8Array): string {
  return `file-${createHash("sha256").update(bytes).digest("hex").slice(0, 48)}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, subscription_status")
    .eq("user_id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!canAccessProfile("file_import", profile)) {
    return NextResponse.json({ error: "File import is not included in your plan." }, { status: 403 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FILE_BYTES + 4096) {
    return NextResponse.json({ error: "That file is too large. The limit is 25 MB." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Choose a GPX, TCX or FIT file." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "That file is too large. The limit is 25 MB." }, { status: 413 });
  }
  const fileName = (file instanceof File ? file.name : "") || "workout";
  const bytes = new Uint8Array(await file.arrayBuffer());

  const kind = detectImportFileKind(fileName, bytes);
  if (!kind) {
    return NextResponse.json(
      { error: "That doesn't look like a GPX, TCX or FIT file." },
      { status: 422 }
    );
  }

  let parsed: ReturnType<typeof parseWorkoutFile>;
  try {
    parsed = parseWorkoutFile(kind, bytes);
  } catch (err) {
    console.error("[activities/import] parse failed:", err instanceof Error ? err.message : err);
    parsed = null;
  }
  if (!parsed) {
    return NextResponse.json(
      { error: "That file has no session in it we can read — no track points, laps or session summary." },
      { status: 422 }
    );
  }

  const startedMs = Date.parse(parsed.startedAt);
  const now = Date.now();
  if (startedMs > now + FUTURE_GRACE_MS) {
    return NextResponse.json({ error: "That session is dated in the future." }, { status: 422 });
  }
  if (now - startedMs > MAX_AGE_DAYS * 86_400_000) {
    return NextResponse.json(
      {
        error: `That session is older than ${MAX_AGE_DAYS} days. Import is for recent sessions; bulk history isn't supported yet.`,
      },
      { status: 422 }
    );
  }

  const preview = toImportPreview(parsed, fileName);
  const clientRequestId = fileClientRequestId(bytes);

  const [{ data: alreadySaved }, { data: nearby }] = await Promise.all([
    supabase
      .from("activities")
      .select("id")
      .eq("user_id", user.id)
      .eq("client_request_id", clientRequestId)
      .maybeSingle(),
    preview.fields.sport
      ? supabase
          .from("activities")
          .select("id, title, started_at, source")
          .eq("user_id", user.id)
          .eq("sport", preview.fields.sport)
          .eq("is_draft", false)
          .gte("started_at", new Date(startedMs - DUPLICATE_WINDOW_MS).toISOString())
          .lte("started_at", new Date(startedMs + DUPLICATE_WINDOW_MS).toISOString())
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    kind,
    fileName,
    clientRequestId,
    preview,
    alreadyImported: alreadySaved ? { id: alreadySaved.id as string } : null,
    duplicateOf: nearby
      ? {
          id: nearby.id as string,
          title: (nearby.title as string | null) ?? null,
          startedAt: nearby.started_at as string,
          source: (nearby.source as string | null) ?? "manual",
        }
      : null,
  });
}
