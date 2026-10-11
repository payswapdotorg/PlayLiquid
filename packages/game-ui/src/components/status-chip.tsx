/**
 * STATUS CHIP (presentational): renders one `UiStatus` from the shared state
 * → tone vocabulary (view/status.ts). Every badge in the Game Studio renders
 * through this component — components never re-derive tone colors from raw
 * domain strings (E1 applied to presentation).
 *
 * Presentational component: props in, elements out; no data fetching, no
 * store access, no IO.
 */

import type { ReactNode } from "react";
import type { UiStatus } from "../view/status.ts";
import { STYLE, TONE_STYLE } from "./tokens.ts";

export interface StatusChipProps {
  /** The mapped status to render (label + tone + optional note). */
  readonly status: UiStatus;
  /** Extra content rendered after the label (e.g. a stale marker). */
  readonly children?: ReactNode;
}

/** One status chip: colored label, note surfaced as title tooltip. */
export function StatusChip({ status, children }: StatusChipProps): ReactNode {
  const tone = TONE_STYLE[status.tone];
  return (
    <span
      title={status.note ?? undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        color: tone.color,
        background: tone.background,
        border: `1px solid ${tone.border}`,
      }}
    >
      {status.label}
      {children}
    </span>
  );
}

/** A small neutral count pill used in tab labels. */
export function CountPill({ count }: { readonly count: number }): ReactNode {
  return (
    <span
      aria-hidden="true"
      style={{
        ...STYLE.mono,
        padding: "0 7px",
        borderRadius: 999,
        fontSize: 11,
        lineHeight: "18px",
        color: STYLE.muted.color,
        background: "rgba(148, 163, 184, 0.12)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
      }}
    >
      {String(count)}
    </span>
  );
}
