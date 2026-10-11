/**
 * PACKAGES PANEL (presentational): renders the Packages read model
 * (view/package-view.ts) — one inspector card per package record with its
 * release-gate verdict, license chip, content digest, dependency table and
 * compatibility lists, plus the owning lockfile pin table (PL-011 / R19).
 *
 * Presentational component: renders `PackagesView` only; selection flows
 * out through the optional `onSelectPackage` callback; no data fetching.
 */

import type { ReactNode } from "react";
import type { PackageCardView, PackagesView } from "../view/package-view.ts";
import { packagesSummary } from "../view/package-view.ts";
import { StatusChip } from "./status-chip.tsx";
import { DataTable, EmptyState, KeyValue, Mono, Panel } from "./primitives.tsx";
import { STYLE } from "./tokens.ts";

export interface PackagesPanelProps {
  readonly view: PackagesView;
  /** The currently selected package id (highlighted card), if any. */
  readonly selectedPackageId?: string | null;
  /** Called when the user picks a package (selection belongs to the app). */
  readonly onSelectPackage?: (packageId: string) => void;
}

function PackageCard({
  card,
  selected,
  onSelect,
}: {
  readonly card: PackageCardView;
  readonly selected: boolean;
  readonly onSelect?: (packageId: string) => void;
}): ReactNode {
  const header = (
    <div style={{ ...STYLE.chipRow, justifyContent: "space-between" }}>
      <div style={STYLE.chipRow}>
        {onSelect === undefined ? (
          <strong style={{ ...STYLE.mono, fontSize: 13 }}>{card.id}</strong>
        ) : (
          <button type="button" style={STYLE.selectButton} onClick={() => onSelect(card.id)}>
            {card.id}
          </button>
        )}
        <span style={STYLE.muted}>·</span>
        <Mono>
          {card.kind} {card.version}
        </Mono>
      </div>
      <div style={STYLE.chipRow}>
        <StatusChip status={card.gate} />
        <StatusChip status={card.license} />
      </div>
    </div>
  );
  return (
    <article style={selected ? STYLE.cardSelected : STYLE.card}>
      {header}
      <KeyValue
        entries={[
          { key: "content digest", value: <Mono>{card.contentDigest}</Mono> },
          { key: "license", value: `${card.spdx} · ${card.license.label}` },
          { key: "artifacts", value: String(card.artifactCount) },
          { key: "lineage", value: card.parentLineage ? "derivative (has parent)" : "original" },
          { key: "runtimes", value: card.runtimes.join(", ") || "—" },
          { key: "engines", value: card.engines.join(", ") || "—" },
          { key: "targets", value: card.targets.join(", ") || "—" },
        ]}
      />
      {card.gateReasons.length === 0 ? null : (
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
          {card.gateReasons.map((reason) => (
            <li key={reason.code} style={{ ...STYLE.muted, fontSize: 12 }}>
              <Mono>{reason.code}</Mono>: {reason.message}
            </li>
          ))}
        </ul>
      )}
      <DataTable
        columns={[
          { key: "id", header: "dependency", render: (row) => <Mono>{row.id}</Mono> },
          { key: "constraint", header: "constraint", render: (row) => <Mono>{row.constraint}</Mono> },
          { key: "kind", header: "kind", render: (row) => (row.kind === null ? "—" : row.kind) },
          { key: "optional", header: "optional", render: (row) => (row.optional ? "yes" : "no") },
        ]}
        rows={card.dependencies}
        rowKey={(row) => row.id}
        empty="no declared dependencies"
      />
    </article>
  );
}

/** The Packages surface: record cards + lockfile pins (PL-011). */
export function PackagesPanel({ view, selectedPackageId, onSelectPackage }: PackagesPanelProps): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel title="Packages" summary={packagesSummary(view)}>
        {view.cards.length === 0 ? (
          <EmptyState label="no package records loaded" />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {view.cards.map((card) => (
              <PackageCard
                key={card.id}
                card={card}
                selected={card.id === selectedPackageId}
                onSelect={onSelectPackage}
              />
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Lockfile pins" summary={`${view.lockPins.length} pinned coordinate${view.lockPins.length === 1 ? "" : "s"}`}>
        <DataTable
          columns={[
            { key: "id", header: "package", render: (row) => <Mono>{row.id}</Mono> },
            { key: "version", header: "version", render: (row) => <Mono>{row.version}</Mono> },
            { key: "digest", header: "content digest", render: (row) => <Mono>{row.digest}</Mono> },
          ]}
          rows={view.lockPins}
          rowKey={(row) => row.id}
          empty="no owning lockfile"
        />
      </Panel>
    </div>
  );
}
