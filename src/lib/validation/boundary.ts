import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BOUND_AGE_YEARS,
  BOUND_BODYWEIGHT_KG,
  BOUND_CADENCE,
  BOUND_DISTANCE_M,
  BOUND_DURATION_S,
  BOUND_ELEVATION_M,
  BOUND_HEIGHT_CM,
  BOUND_HRV_MS,
  BOUND_HR_BPM,
  BOUND_LIFT_LOAD_KG,
  BOUND_MAX_HR_BPM,
  BOUND_POWER_WATTS,
  BOUND_REPS,
  BOUND_RESTING_HR_BPM,
  BOUND_RPE,
  BOUND_SETS,
  BOUND_TEMPERATURE_C,
  MAX_NAME_LEN,
  MAX_NOTES_LEN,
  MAX_REQUEST_BODY_BYTES,
  MAX_TITLE_LEN,
} from "@/lib/security/config";

/**
 * The API boundary. Everything crossing it is parsed here, and a handler only
 * ever sees a value that has already been proved to be what it claims.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before it, no route in this app validated its input server-side. Zod was a
 * dependency used in exactly one file — a client component — which is the
 * brief's opening line made literal: client-side validation is a UX feature,
 * not a security control.
 *
 * The specific hazard here is not injection. It is that the scoring engine has
 * physical assumptions baked into arithmetic. Bodyweight sits in a denominator
 * in relative_strength; the Riegel exponent is fitted from an athlete's own
 * efforts; the adaptive 1RM walk reads the full history per lift. Feed any of
 * those a zero, a negative, a 10^9, a NaN or a string and you do not get an
 * error — you get a number, stored, that quietly biases every later estimate
 * for that athlete.
 *
 * REJECT, NEVER CLAMP
 * -------------------
 * The tempting alternative is to clamp out-of-range values into the plausible
 * band and carry on, because it never inconveniences anybody. It is wrong for
 * one specific reason: a clamped value is a fabricated data point that the
 * athlete never entered, sitting in a history that later estimates are fitted
 * against. A rejection costs one retry. A clamp corrupts a curve, silently,
 * and there is no way to tell afterwards which points were real.
 */

/** A field-level problem, in the shape the client renders next to the input. */
export interface FieldError {
  path: string;
  message: string;
}

export interface ValidationFailure {
  response: NextResponse;
  data?: never;
}
export interface ValidationSuccess<T> {
  data: T;
  response?: never;
}
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(body)",
    message: issue.message,
  }));
}

/**
 * A 400 carrying field-level messages.
 *
 * Deliberately says nothing about the database, the schema, or the stack. The
 * client gets what it needs to point at the offending input and nothing an
 * attacker can map the backend with — see WP5.
 */
export function invalidRequest(fields: FieldError[]): NextResponse {
  return NextResponse.json(
    {
      error: fields.length === 1 ? fields[0].message : "Some of that could not be saved.",
      fields,
    },
    { status: 400 }
  );
}

/**
 * Parse a JSON body against a schema.
 *
 * Three failure modes, all 4xx, all before the handler runs:
 *   - oversized: rejected on Content-Length before the body is read into memory
 *   - unparseable: malformed JSON, or no body at all
 *   - invalid: parsed, but not the shape or range the schema requires
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<ValidationResult<z.infer<T>>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BODY_BYTES) {
    return {
      response: NextResponse.json(
        { error: "That request is too large.", fields: [] },
        { status: 413 }
      ),
    };
  }

  let raw: unknown;
  try {
    const text = await request.text();
    // Checked again after reading: Content-Length is a claim, not a fact, and
    // a chunked request does not have to send one at all.
    if (text.length > MAX_REQUEST_BODY_BYTES) {
      return {
        response: NextResponse.json(
          { error: "That request is too large.", fields: [] },
          { status: 413 }
        ),
      };
    }
    raw = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    return {
      response: invalidRequest([{ path: "(body)", message: "Expected a JSON body." }]),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { response: invalidRequest(fieldErrors(parsed.error)) };
  return { data: parsed.data };
}

/**
 * Parse query parameters against a schema.
 *
 * Everything arrives as a string, so schemas here use the coercing helpers
 * below rather than z.number(). Repeated keys collapse to the first value,
 * which matches what `searchParams.get` already did — stated so nobody
 * discovers it as a surprise.
 */
export function parseQuery<T extends z.ZodType>(
  request: Request,
  schema: T
): ValidationResult<z.infer<T>> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!(key in params)) params[key] = value;
  }

  const parsed = schema.safeParse(params);
  if (!parsed.success) return { response: invalidRequest(fieldErrors(parsed.error)) };
  return { data: parsed.data };
}

/**
 * Parse a dynamic route segment — the `[id]` in a path.
 *
 * Ownership is a separate question and this does not answer it. All this
 * guarantees is that the value is a uuid, so a handler cannot be handed
 * "../../etc" or a 4MB string to put in a WHERE clause. Whether the caller
 * owns that id is checked in the handler, every time.
 */
export const uuidParam = z.string().uuid("That is not a valid id.");

export async function parseParams<T extends z.ZodType>(
  params: Promise<Record<string, string>>,
  schema: T
): Promise<ValidationResult<z.infer<T>>> {
  const parsed = schema.safeParse(await params);
  if (!parsed.success) return { response: invalidRequest(fieldErrors(parsed.error)) };
  return { data: parsed.data };
}

// ── Reusable field schemas ───────────────────────────────────────────────────
// Built from the bounds in lib/security/config.ts so a route cannot invent its
// own idea of a plausible heart rate.

/**
 * A bounded number.
 *
 * `.finite()` is not decoration: JSON.parse will not produce Infinity, but
 * `1e999` parses to Infinity and NaN arrives through several arithmetic paths.
 * Either one propagates through the scoring engine without throwing and comes
 * out the far end as a stored null or a poisoned average.
 */
export function bounded(
  [min, max]: readonly [number, number],
  unit: string
): z.ZodNumber {
  return z
    .number({ message: `Enter a number for ${unit}.` })
    .finite(`That is not a usable ${unit}.`)
    .min(min, `${unit} must be at least ${min}.`)
    .max(max, `${unit} must be at most ${max}.`);
}

/**
 * Same, for query strings, where everything arrives as text.
 *
 * `Number("")` is 0 and `Number(" ")` is 0, either of which would turn an empty
 * parameter into a silently valid zero, so the empty case is rejected before
 * the conversion rather than after it.
 */
export function boundedParam(bounds: readonly [number, number], unit: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter a number for ${unit}.`)
    .transform((v) => Number(v))
    .pipe(bounded(bounds, unit));
}

export const numberFields = {
  bodyweightKg: bounded(BOUND_BODYWEIGHT_KG, "bodyweight"),
  liftLoadKg: bounded(BOUND_LIFT_LOAD_KG, "weight"),
  reps: bounded(BOUND_REPS, "reps").int("Reps must be a whole number."),
  sets: bounded(BOUND_SETS, "sets").int("Sets must be a whole number."),
  heartRate: bounded(BOUND_HR_BPM, "heart rate").int(),
  maxHeartRate: bounded(BOUND_MAX_HR_BPM, "max heart rate").int(),
  restingHeartRate: bounded(BOUND_RESTING_HR_BPM, "resting heart rate").int(),
  distanceM: bounded(BOUND_DISTANCE_M, "distance"),
  durationS: bounded(BOUND_DURATION_S, "duration").int("Duration must be whole seconds."),
  ageYears: bounded(BOUND_AGE_YEARS, "age").int(),
  heightCm: bounded(BOUND_HEIGHT_CM, "height"),
  rpe: bounded(BOUND_RPE, "RPE"),
  hrvMs: bounded(BOUND_HRV_MS, "HRV"),
  elevationM: bounded(BOUND_ELEVATION_M, "elevation"),
  powerWatts: bounded(BOUND_POWER_WATTS, "power"),
  cadence: bounded(BOUND_CADENCE, "cadence"),
  temperatureC: bounded(BOUND_TEMPERATURE_C, "temperature"),
};

/**
 * Free text.
 *
 * Trimmed and length-capped, not sanitised. React escapes on output, so
 * stripping characters here would corrupt legitimate content — an athlete
 * whose notes say "5x5 @ <RPE 8>" means that — to defend against an attack
 * this rendering path does not have. The places that genuinely need output
 * escaping are `dangerouslySetInnerHTML` and the OG image routes, and those
 * are handled where they render, not by mangling the stored value.
 */
export function text(maxLen: number, label: string) {
  return z
    .string({ message: `${label} must be text.` })
    .trim()
    .max(maxLen, `${label} must be ${maxLen} characters or fewer.`);
}

export const textFields = {
  title: text(MAX_TITLE_LEN, "Title"),
  name: text(MAX_NAME_LEN, "Name"),
  notes: text(MAX_NOTES_LEN, "Notes"),
};

/** An ISO timestamp we are willing to put in a WHERE clause. */
export const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a valid date.");

export { z };
