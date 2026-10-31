/**
 * STATUS CHIP (presentational): renders one `UiStatus` as a chip, plus
 * the count pill used by the shell's tab navigation. The tone → style
 * mapping is the ONE owner (components/tokens.ts); this component never
 * re-derives tones (game-ui/gameos-lab/gameos-community precedent).
 */

import type { ReactNode } from "react";
import type { UiStatus } from "../view/status.ts";
import { STYLE, TONE_STYLE } from "./tokens.ts";

export interface StatusChipProps {
  readonly status: UiStatus;
}

/** One status chip (label + tone; the note renders as its title). */
export function StatusChip({ status }: StatusChipProps): ReactNode {
  const tone = TONE_STYLE[status.tone];
  return (
    <span
      title={status.note ?? undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontFamily: STYLE.mono.fontFamily,
        whiteSpace: "nowrap",
        color: tone.color,
        background: tone.background,
        border: `1px solid ${tone.border}`,
      }}
    >
      {status.label}
    </span>
  );
}

/** A numeric count pill for tab navigation. */
export function CountPill({ count }: { readonly count: number }): ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 10.5,
        fontFamily: STYLE.mono.fontFamily,
        color: "#0b1220",
        background: "#2dd4bf",
        fontWeight: 700,
      }}
    >
      {count}
    </span>
  );
}
