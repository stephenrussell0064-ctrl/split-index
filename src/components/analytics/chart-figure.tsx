import { useId, type ReactNode } from "react";

/**
 * N7 item 1 — a chart that a screen reader can actually read.
 *
 * WHAT WAS THERE, AND WHY IT WAS NOT ENOUGH
 * ----------------------------------------
 * Eight chart surfaces already carried `role="img"` with a descriptive
 * `aria-label`, e.g. "Index trend chart showing split, endurance, and strength
 * over 20 data points". Eight carried nothing at all. None carried the data.
 *
 * A label names the picture. WCAG 1.1.1 asks for a text alternative that serves
 * the EQUIVALENT PURPOSE, and the purpose of a trend chart is not "there is a
 * trend chart here" — it is which way the number went, by how much, and over
 * what period. A sighted athlete gets that in half a second. Everyone else got
 * a noun.
 *
 * WHAT THIS RENDERS
 * -----------------
 * Two things, deliberately as siblings rather than nested:
 *
 *   1. The chart, wrapped in `role="img"` with the label. `role="img"` makes
 *      its whole subtree presentational, which is right for a pile of SVG paths
 *      — and is exactly why the table cannot live inside it.
 *   2. An `sr-only` figure holding a one-sentence summary and a real `<table>`.
 *      A table rather than a paragraph of numbers because screen readers have
 *      table navigation — row by row, column by column, with the headers
 *      announced — and a comma-separated list throws that away.
 *
 * WHY THE SUMMARY IS WRITTEN BY THE CALLER
 * ----------------------------------------
 * It could be derived — first value, last value, direction. It is not, because
 * "Split Index rose from 412 to 448 over 12 weeks" and "your acute:chronic
 * ratio stayed inside the optimal band all month" are the same shape of data
 * and completely different sentences. The component cannot know which number
 * matters. Making it a required prop means whoever adds a chart has to say what
 * it is for, which is the same reason `contentSummary` is required on the share
 * button.
 *
 * ROW CAP
 * -------
 * A year of daily points is 365 rows, and a screen reader user tabbing into
 * that has been handed a worse problem than the one being fixed. Long series
 * are capped and the table says so; the summary is what carries the meaning at
 * that length, which is what a sighted reader takes from the shape of the line
 * anyway.
 */

const MAX_ROWS = 40;

export interface ChartColumn<T> {
  /** Column heading, announced before each cell in that column. */
  header: string;
  /** The cell value. Return a string — formatting decisions belong to the caller. */
  cell: (row: T) => string;
}

interface ChartFigureProps<T> {
  /** Names the picture: "Split Index trend". Not a sentence, not the data. */
  label: string;
  /**
   * What the chart says, in one sentence, with the numbers that matter.
   * This is the text alternative; the table is the detail behind it.
   */
  summary: string;
  columns: ChartColumn<T>[];
  rows: T[];
  /** The chart itself. */
  children: ReactNode;
}

export function ChartFigure<T>({
  label,
  summary,
  columns,
  rows,
  children,
}: ChartFigureProps<T>) {
  const captionId = useId();
  const shown = rows.slice(0, MAX_ROWS);
  const truncated = rows.length - shown.length;

  return (
    <>
      <div role="img" aria-label={label}>
        {children}
      </div>

      {/*
        `sr-only` and not `hidden`: this has to stay in the accessibility tree.
        A visually hidden node is read; a `display: none` one is not, and
        `aria-hidden` would defeat the entire point.
      */}
      <div className="sr-only">
        <p id={captionId}>{summary}</p>

        {rows.length > 0 && (
          <table aria-describedby={captionId}>
            <caption>
              {label}
              {truncated > 0
                ? ` — first ${shown.length} of ${rows.length} points; the summary above covers the whole period`
                : ""}
            </caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.header} scope="col">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i}>
                  {columns.map((c, j) =>
                    // The first column is the row's identity — a date, a zone
                    // name — so it is a header cell. That is what lets a screen
                    // reader say "week 3, load 412" instead of just "412".
                    j === 0 ? (
                      <th key={c.header} scope="row">
                        {c.cell(row)}
                      </th>
                    ) : (
                      <td key={c.header}>{c.cell(row)}</td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
