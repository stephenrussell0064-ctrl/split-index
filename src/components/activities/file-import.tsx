"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENDURANCE_SPORTS, SESSION_TYPES, SPORTS } from "@/lib/constants/sports";
import type { ActivityFormData, SessionType, SportType } from "@/types";
import type { ImportPreview } from "@/lib/import/parsers";

/**
 * Pick a file, see what it is, say what it was, save.
 *
 * Two requests. The first sends the file to /api/activities/import and gets
 * back a preview: the fields the scorer will read, whether this exact file
 * has been imported before, and whether a session of the same sport already
 * sits around the same minute. The second is an ordinary POST to
 * /api/activities with `source: "file"` and a `client_request_id` derived
 * from the file's hash, which is what makes a second upload of the same file
 * answer with the first save rather than a second session.
 *
 * The athlete confirms three things the file cannot know for certain: the
 * sport (a GPX often does not say; a FIT "cycling" could be indoor), the
 * session type (easy, tempo, race — nothing in a file says how hard it was
 * meant to be), and the title. Everything else is shown, not asked.
 *
 * Posted with fetch rather than submitActivityRequest: that helper mints its
 * own idempotency key, and this save needs the file's. A file upload needs a
 * connection anyway, so the offline queue has nothing to add here.
 */

interface PreviewResponse {
  kind: "gpx" | "tcx" | "fit";
  fileName: string;
  clientRequestId: string;
  preview: ImportPreview;
  alreadyImported: { id: string } | null;
  duplicateOf: { id: string; title: string | null; startedAt: string; source: string } | null;
}

// Extensions only. The TCX MIME type carries a vendor name, and the copy
// guard (no-competitor-names-in-copy.test.ts) reads this string as copy.
const ACCEPT = ".gpx,.tcx,.fit";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function FileImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"pick" | "reading" | "preview" | "saving">("pick");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [sport, setSport] = useState<SportType | "">("");
  const [sessionType, setSessionType] = useState<SessionType>("easy");
  const [title, setTitle] = useState("");

  async function readFile(file: File) {
    setPhase("reading");
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch("/api/activities/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as (PreviewResponse & { error?: string }) | null;
      if (!res.ok || !body) {
        throw new Error(body?.error ?? "That file couldn't be read.");
      }
      setResult(body);
      setSport(body.preview.fields.sport ?? "");
      setTitle(body.preview.fields.title);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file couldn't be read.");
      setPhase("pick");
    }
  }

  async function save() {
    if (!result || !sport) return;
    setPhase("saving");
    setError(null);
    const { fields } = result.preview;
    const payload: ActivityFormData & { client_request_id: string; route?: unknown; streams?: unknown } = {
      sport,
      title: title.trim() || undefined,
      started_at: fields.started_at,
      duration_seconds: fields.duration_seconds,
      distance_meters: fields.distance_meters,
      elevation_meters: fields.elevation_meters,
      avg_heart_rate: fields.avg_heart_rate,
      max_heart_rate: fields.max_heart_rate,
      avg_cadence: fields.avg_cadence,
      avg_pace_seconds_per_km: fields.avg_pace_seconds_per_km,
      session_type: sessionType,
      source: "file",
      client_request_id: result.clientRequestId,
      ...(result.preview.route ? { route: result.preview.route } : {}),
      ...(result.preview.streams ? { streams: result.preview.streams } : {}),
    };
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { activity?: { id?: string }; activity_id?: string; error?: string }
        | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "That couldn't be saved.");
      const id = body.activity?.id ?? body.activity_id;
      if (id) router.push(`/activities/${id}`);
      else router.push("/cardio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That couldn't be saved.");
      setPhase("preview");
    }
  }

  const fields = result?.preview.fields;
  const sportOptions = SPORTS.filter((s) => ENDURANCE_SPORTS.includes(s.id));

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <Link href="/cardio" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Engine
      </Link>

      <div>
        <p className="micro-label text-cardio-accent">Endurance · The Engine</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Import a file</h1>
        <p className="mt-1 text-sm text-muted">
          A GPX, TCX or FIT export from any watch or app becomes a scored session, with its map and splits
          where the file carries a track.
        </p>
      </div>

      <Card padding="lg">
        <CardContent className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
          <Button
            variant={result ? "secondary" : "default"}
            onClick={() => inputRef.current?.click()}
            disabled={phase === "reading" || phase === "saving"}
          >
            {phase === "reading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {result ? "Choose a different file" : "Choose a file"}
          </Button>
          <p className="text-xs text-muted">Sessions from the last 90 days. Up to 25 MB.</p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </CardContent>
      </Card>

      {result && fields && (
        <Card padding="lg">
          <CardHeader>
            <CardTitle>
              {result.fileName} · {result.kind.toUpperCase()}
              {result.preview.deviceName ? ` · ${result.preview.deviceName}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.alreadyImported && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                This file is already in your log.{" "}
                <Link href={`/activities/${result.alreadyImported.id}`} className="underline">
                  See the session
                </Link>
                . Saving again returns that session rather than a second one.
              </p>
            )}
            {!result.alreadyImported && result.duplicateOf && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                You already have a {result.duplicateOf.source === "gps" ? "recorded" : "logged"} session around
                this time:{" "}
                <Link href={`/activities/${result.duplicateOf.id}`} className="underline">
                  {result.duplicateOf.title ?? "see it"}
                </Link>
                . Saving this adds a second one.
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <div>
                <dt className="micro-label text-[9px] text-muted/60">When</dt>
                <dd className="mt-1 text-sm font-semibold">
                  {new Date(fields.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </dd>
              </div>
              <div>
                <dt className="micro-label text-[9px] text-muted/60">Time</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums">{formatDuration(fields.duration_seconds)}</dd>
              </div>
              {fields.distance_meters != null && (
                <div>
                  <dt className="micro-label text-[9px] text-muted/60">Distance</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{(fields.distance_meters / 1000).toFixed(2)} km</dd>
                </div>
              )}
              {fields.avg_pace_seconds_per_km != null && (
                <div>
                  <dt className="micro-label text-[9px] text-muted/60">Pace</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{formatPace(fields.avg_pace_seconds_per_km)}</dd>
                </div>
              )}
              {fields.avg_heart_rate != null && (
                <div>
                  <dt className="micro-label text-[9px] text-muted/60">Avg HR</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">
                    {fields.avg_heart_rate}
                    {fields.max_heart_rate != null ? ` / ${fields.max_heart_rate} max` : ""} bpm
                  </dd>
                </div>
              )}
              {fields.elevation_meters != null && (
                <div>
                  <dt className="micro-label text-[9px] text-muted/60">Climb</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{fields.elevation_meters} m</dd>
                </div>
              )}
              <div>
                <dt className="micro-label text-[9px] text-muted/60">Track</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums">
                  {result.preview.pointCount > 0
                    ? `${result.preview.pointCount} points${result.preview.streams ? ", splits and map" : ""}`
                    : "none"}
                </dd>
              </div>
            </dl>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="micro-label text-muted">Sport</span>
                <select
                  value={sport}
                  onChange={(e) => setSport(e.target.value as SportType | "")}
                  className="mt-1 h-11 w-full rounded-xl glass border border-white/10 px-3 text-base text-foreground focus:border-accent/50 focus:outline-none"
                >
                  <option value="">
                    {fields.sportHint ? `Pick one (file says "${fields.sportHint}")` : "Pick one"}
                  </option>
                  {sportOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="micro-label text-muted">Session type</span>
                <select
                  value={sessionType}
                  onChange={(e) => setSessionType(e.target.value as SessionType)}
                  className="mt-1 h-11 w-full rounded-xl glass border border-white/10 px-3 text-base text-foreground focus:border-accent/50 focus:outline-none"
                >
                  {SESSION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="micro-label text-muted">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  className="mt-1 h-11 w-full rounded-xl glass border border-white/10 px-3 text-base text-foreground focus:border-accent/50 focus:outline-none"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={!sport || phase === "saving"}>
                {phase === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {result.alreadyImported ? "Open the saved session" : "Save to my log"}
              </Button>
              {!sport && <p className="text-xs text-muted">Pick the sport to save.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
