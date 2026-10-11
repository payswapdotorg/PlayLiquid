/**
 * SESSION PANEL (presentational): renders the runtime session read model
 * (view/runtime-view.ts) — the session header card (phase chip, epoch, tick,
 * sequence cursors), the latest observed events and the append-only
 * operation timeline with per-row outcome chips and stale-epoch markers
 * (PL-013; E10 history is never rewritten, stale results are surfaced).
 *
 * Presentational component: renders `SessionView` only; no data fetching.
 */

import type { ReactNode } from "react";
import type { SessionTimelineRow, SessionView } from "../view/runtime-view.ts";
import { sessionSummary } from "../view/runtime-view.ts";
import { StatusChip } from "./status-chip.tsx";
import { EmptyState, KeyValue, Mono, Panel } from "./primitives.tsx";
import { STYLE } from "./tokens.ts";

/** One timeline row: operation, outcome chip, detail, epoch + stale marker. */
function TimelineRow({ row }: { readonly row: SessionTimelineRow }): ReactNode {
  return (
    <li style={{ display: "grid", gap: 2 }}>
      <span style={{ ...STYLE.chipRow, justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <Mono>{row.operation}</Mono>
          <StatusChip status={row.status} />
          {row.stale ? (
            <StatusChip status={{ label: "stale", tone: "warn", note: "result from an older session epoch" }} />
          ) : null}
        </span>
        <span style={{ ...STYLE.mono, fontSize: 11.5, color: STYLE.faint.color }}>epoch {String(row.epoch)}</span>
      </span>
      <p style={{ ...STYLE.muted, margin: 0, fontSize: 12 }}>{row.detail}</p>
    </li>
  );
}

/** The Session surface: session card, latest events, operation timeline. */
export function SessionPanel({ view }: { readonly view: SessionView }): ReactNode {
  const card = view.card;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel title="Runtime session" summary={sessionSummary(view)}>
        {card === undefined ? (
          <EmptyState label="no active runtime session" />
        ) : (
          <KeyValue
            entries={[
              { key: "session", value: <Mono>{card.sessionId}</Mono> },
              { key: "role", value: <Mono>{card.role}</Mono> },
              { key: "phase", value: <StatusChip status={card.phase} /> },
              { key: "epoch", value: <Mono>{String(card.epoch)}</Mono> },
              { key: "tick", value: <Mono>{String(card.tick)}</Mono> },
              { key: "committed events", value: <Mono>{String(card.committedEventSeq)}</Mono> },
              { key: "admitted commands", value: <Mono>{String(card.admittedCommandSeq)}</Mono> },
            ]}
          />
        )}
      </Panel>
      <Panel
        title="Latest observation"
        summary={
          view.latestEvents.length === 0
            ? "no observation yet"
            : `${view.latestEvents.length} event${view.latestEvents.length === 1 ? "" : "s"} in the latest observation`
        }
      >
        {view.latestEvents.length === 0 ? (
          <EmptyState label="no observed events" />
        ) : (
          <div style={STYLE.chipRow}>
            {view.latestEvents.map((event) => (
              <span key={String(event.seq)} style={{ ...STYLE.mono, fontSize: 11.5, color: STYLE.muted.color }}>
                #{String(event.seq)} <span style={{ color: "#2dd4bf" }}>{event.kind}</span>
              </span>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Operation timeline"
        summary={`${view.timeline.length} recorded operation${view.timeline.length === 1 ? "" : "s"} (append-only, E10)`}
      >
        {view.timeline.length === 0 ? (
          <EmptyState label="no operations recorded yet" />
        ) : (
          <div style={{ maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {view.timeline.map((row, index) => (
                <TimelineRow key={`${row.operation}-${String(index)}`} row={row} />
              ))}
            </ol>
          </div>
        )}
      </Panel>
    </div>
  );
}
