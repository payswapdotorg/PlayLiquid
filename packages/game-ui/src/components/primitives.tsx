/**
 * SHARED PRESENTATIONAL PRIMITIVES (pure): the small building blocks every
 * studio panel renders with — a titled `Panel`, a generic `DataTable`, a
 * `Banner` for load failures, `EmptyState` for absent surfaces and a `Mono`
 * text style for ids/digests/sequences. One owner of table/panel markup so
 * the five surfaces stay visually identical (E1 applied to presentation).
 *
 * Presentational components: props in, elements out; no data fetching, no
 * store access, no IO. `DataTable` rows carry no click behavior — selection
 * flows through explicit buttons rendered by the panels.
 */

import type { ReactNode } from "react";
import { STYLE } from "./tokens.ts";

/** A titled surface section with a deterministic summary line. */
export function Panel({
  title,
  summary,
  children,
}: {
  readonly title: string;
  readonly summary?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section style={STYLE.panel}>
      <header style={STYLE.panelHeader}>
        <h2 style={STYLE.panelTitle}>{title}</h2>
        {summary === undefined ? null : <p style={STYLE.panelSummary}>{summary}</p>}
      </header>
      <div style={STYLE.panelBody}>{children}</div>
    </section>
  );
}

/** A visible failure banner (E11: load failures are rendered, never silent). */
export function Banner({
  tone,
  children,
}: {
  readonly tone: "error" | "info";
  readonly children: ReactNode;
}): ReactNode {
  const color = tone === "error" ? "#f87171" : "#2dd4bf";
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      style={{
        margin: 0,
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 12.5,
        fontFamily: STYLE.mono.fontFamily,
        color,
        background: tone === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(45, 212, 191, 0.08)",
        border: `1px solid ${tone === "error" ? "rgba(248, 113, 113, 0.4)" : "rgba(45, 212, 191, 0.35)"}`,
      }}
    >
      {children}
    </p>
  );
}

/** Deterministic monospace text (ids, digests, epochs, sequences). */
export function Mono({ children }: { readonly children: ReactNode }): ReactNode {
  return <span style={STYLE.mono}>{children}</span>;
}

/** Shown when a surface has no authoritative data (absence is a visible state). */
export function EmptyState({ label }: { readonly label: string }): ReactNode {
  return (
    <p style={{ ...STYLE.muted, margin: 0, fontSize: 12.5, fontStyle: "italic" }}>{label}</p>
  );
}

/** One column definition of a `DataTable`. */
export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows. */
  readonly empty: string;
}

/** A minimal accessible data table (th scope=col, td per column). */
export function DataTable<Row>({ columns, rows, rowKey, empty }: DataTableProps<Row>): ReactNode {
  if (rows.length === 0) return <EmptyState label={empty} />;
  return (
    <table style={STYLE.table}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" style={STYLE.th}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key} style={STYLE.td}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A definition-list style key/value grid for inspector cards. */
export function KeyValue({ entries }: { readonly entries: readonly { readonly key: string; readonly value: ReactNode }[] }): ReactNode {
  if (entries.length === 0) return null;
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 12.5 }}>
      {entries.map((entry) => (
        <div key={entry.key} style={{ display: "contents" }}>
          <dt style={{ ...STYLE.muted, whiteSpace: "nowrap" }}>{entry.key}</dt>
          <dd style={{ margin: 0, color: STYLE.td.color }}>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A labeled chip list (capability/intent chips share this markup). */
export function ChipList({
  label,
  chips,
  empty,
}: {
  readonly label: string;
  readonly chips: readonly ReactNode[];
  readonly empty: string;
}): ReactNode {
  return (
    <div>
      <p style={{ ...STYLE.panelSummary, margin: "0 0 6px" }}>{label}</p>
      {chips.length === 0 ? <EmptyState label={empty} /> : <div style={STYLE.chipRow}>{chips}</div>}
    </div>
  );
}
