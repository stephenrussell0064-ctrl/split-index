/**
 * Writes that survive a database behind on an additive migration.
 *
 * The rule this encodes, learned the hard way when one unapplied migration
 * took down gym logging entirely (see insertGymExercises): a column added for
 * a feature must never be able to cost the athlete the session that feature
 * decorates. PostgREST rejects a whole statement for one unknown column, and
 * the create path unwinds the session when its primary write fails, so an
 * additive column in a load-bearing insert is a single point of failure for
 * everything around it.
 *
 * So: try the write with the column, and if — and only if — the failure is
 * the database saying it has no such column, drop that column and try again.
 * Any other error is returned untouched, because it is a real failure.
 */

/** The shape PostgREST hands back on a failed write — only the fields we branch on. */
export type WriteError = { message: string; code?: string } | null;

/**
 * Does this error say the table has no such column?
 *
 * PostgREST reports an unknown column on a WRITE as PGRST204 ("Could not find
 * the 'x' column of 't' in the schema cache") and on a READ as Postgres' own
 * 42703 ("column t.x does not exist"). Both shapes are matched, and the
 * message is checked too, because which one comes back depends on the
 * PostgREST version in front of the database rather than on anything this
 * code controls.
 */
export function missingColumn(error: WriteError, candidates: readonly string[]): string | null {
  if (!error) return null;
  const code = error.code ?? "";
  const message = error.message ?? "";
  const looksLikeMissingColumn =
    code === "PGRST204" || code === "42703" || /schema cache|does not exist/i.test(message);
  if (!looksLikeMissingColumn) return null;
  return candidates.find((column) => new RegExp(`\\b${column}\\b`).test(message)) ?? null;
}

function stripColumn<T extends Record<string, unknown>>(rows: T[], column: string): T[] {
  return rows.map((row) => {
    const rest = { ...row };
    delete rest[column];
    return rest;
  });
}

/**
 * Run `write`, retrying without any degradable column the database turns out
 * not to have. `write` is a full statement — including any `.select()` — so
 * the caller keeps whatever it needs back from the row.
 *
 * Returns which columns were dropped so the caller can log them: that log is
 * what tells an operator to apply the migration, and it is the only cost of
 * not having done so yet.
 */
async function retryWithoutMissingColumns<Payload, Result extends { error: WriteError }>(
  initial: Payload,
  degradable: readonly string[],
  strip: (payload: Payload, column: string) => Payload,
  write: (payload: Payload) => PromiseLike<Result>
): Promise<Result & { droppedColumns: string[] }> {
  let payload = initial;
  const droppedColumns: string[] = [];

  // At most one attempt per degradable column, plus the first — a bounded
  // loop, so a database missing several of them still terminates.
  for (let attempt = 0; attempt <= degradable.length; attempt++) {
    const result = await write(payload);
    if (!result.error) return { ...result, droppedColumns };

    const remaining = degradable.filter((c) => !droppedColumns.includes(c));
    const absent = missingColumn(result.error, remaining);
    if (!absent) return { ...result, droppedColumns };

    droppedColumns.push(absent);
    payload = strip(payload, absent);
  }

  return { ...(await write(payload)), droppedColumns };
}

/** Many rows, inserted as a batch. */
export function writeTolerantly<Row extends Record<string, unknown>, Result extends { error: WriteError }>(
  rows: Row[],
  degradable: readonly string[],
  write: (payload: Record<string, unknown>[]) => PromiseLike<Result>
): Promise<Result & { droppedColumns: string[] }> {
  return retryWithoutMissingColumns(
    rows.map((row) => ({ ...row }) as Record<string, unknown>),
    degradable,
    stripColumn,
    write
  );
}

/**
 * One row, written as a single object rather than a one-element array.
 *
 * The distinction matters to more than tidiness: `workout_scores` is written
 * with `.insert(row).select().single()`, and wrapping that row in an array
 * changes the shape of the statement every caller and test around it expects.
 */
export function writeRowTolerantly<Row extends Record<string, unknown>, Result extends { error: WriteError }>(
  row: Row,
  degradable: readonly string[],
  write: (payload: Record<string, unknown>) => PromiseLike<Result>
): Promise<Result & { droppedColumns: string[] }> {
  return retryWithoutMissingColumns(
    { ...row } as Record<string, unknown>,
    degradable,
    (payload, column) => stripColumn([payload], column)[0],
    write
  );
}

/**
 * Columns whose absence must never cost a session its score.
 *
 * `personal_index` (migration 077) is the session measured against the
 * athlete's own recent history. The engine also writes it into
 * `score_breakdown.personal_index`, which is JSONB and needs no migration, so
 * a database without the column still has the number — it just cannot render
 * a list of sessions without reading every breakdown. Losing the column costs
 * a display optimisation. It must not cost the workout.
 */
export const DEGRADABLE_SCORE_COLUMNS = ["personal_index"] as const;
