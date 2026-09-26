/**
 * Voiceover for the showreels, generated locally.
 *
 *   npx tsx scripts/gen-vo.ts            # all showreels
 *   npx tsx scripts/gen-vo.ts OneScore   # one
 *
 * Uses macOS `say` (the "Daniel" en-GB voice) so the track is self-generated
 * and royalty-free — a placeholder with the right timing. Swap any line for a
 * human read by dropping a wav at public/vo/<id>/<n>.wav with the same name;
 * re-run this script with --keep to only regenerate missing lines and refresh
 * the durations.
 *
 * Writes public/vo/<id>/<n>.wav and src/showreel/vo-durations.json, which the
 * composition reads to size each beat to its line.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHOWREELS } from "../src/showreel/scripts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "vo");
const JSON_OUT = join(ROOT, "src", "showreel", "vo-durations.json");
const VOICE = process.env.VO_VOICE ?? "Daniel";
const RATE = process.env.VO_RATE ?? "172";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.find((a) => !a.startsWith("--"));

function run(cmd: string[], opts: { stdio?: "pipe" | "inherit" } = {}) {
  return execFileSync(cmd[0], cmd.slice(1), { encoding: "utf8", stdio: opts.stdio ?? "pipe" });
}

/** Duration from the WAV header itself — no subprocess, no ffprobe stderr parsing. */
function durationOf(wav: string): number {
  const buf = readFileSync(wav);
  let pos = 12;
  let byteRate = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(pos + 16);
    if (id === "data") {
      if (!byteRate) throw new Error(`no fmt chunk in ${wav}`);
      return size / byteRate;
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${wav}`);
}

function speak(text: string, wav: string) {
  // `say` writes WAV directly when asked for a PCM data format; Remotion's
  // bundled ffmpeg cannot read AIFF, so this avoids a conversion step.
  run(["say", "-v", VOICE, "-r", RATE, "--data-format=LEI16@48000", "-o", wav, text]);
}

const durations: Record<string, number[]> = existsSync(JSON_OUT) ? JSON.parse(readFileSync(JSON_OUT, "utf8")) : {};

for (const s of SHOWREELS) {
  if (only && s.id !== only) continue;
  const dir = join(OUT, s.id);
  mkdirSync(dir, { recursive: true });
  const lines = [...s.beats.map((b) => b.vo), s.outroVo];
  const secs: number[] = [];
  lines.forEach((line, i) => {
    const wav = join(dir, `${i}.wav`);
    if (!(keep && existsSync(wav))) speak(line, wav);
    const d = durationOf(wav);
    secs.push(Math.round(d * 1000) / 1000);
    console.log(`${s.id} ${i}  ${d.toFixed(2)}s  ${line}`);
  });
  durations[s.id] = secs;
}

writeFileSync(JSON_OUT, JSON.stringify(durations, null, 2) + "\n");
console.log(`wrote ${JSON_OUT}`);
