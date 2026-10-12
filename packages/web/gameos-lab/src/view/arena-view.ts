/**
 * ARENA ESCALATION READ MODELS (pure): project
 * arena-integration-runtime's decided escalation cases
 * (ArenaEscalationCase, PL-031) into typed view models for the
 * workbench's Arena surface.
 *
 * Discipline: these are DECIDED escalations only — the runtime never
 * auto-escalates (R18), and this view never sends anything; it renders
 * the case's lifecycle state, its decision provenance (decidedBy/
 * decidedAt), and the filed evidence package (ingested OR
 * rejected-verdict — a refusal is evidence too, E10).
 *
 * Tenancy (R20): a case belonging to a tenant other than the viewer's
 * renders as a visible foreign-tenant row and can never be opened into
 * a detail view.
 *
 * Pure module: no IO, no React, no clock, no transport.
 */

import type { ArenaEscalationCase } from "../../../../arena-integration-runtime/src/index.ts";
import type { LabViewer } from "./lab-selection.ts";

/** One Arena escalation case row. */
export interface ArenaCaseRowView {
  readonly caseId: string;
  readonly tenant: string;
  /** The host subject whose DECIDED command opened the case (R18). */
  readonly decidedBy: string;
  readonly sourceKind: string;
  readonly requestKind: string;
  readonly lifecycleState: string;
  /** The walked lifecycle states, in order (append-only, E10). */
  readonly lifecycleTrail: string;
  /** The filed evidence package verdict, once settled (E10/E11). */
  readonly evidenceVerdict: string | null;
  readonly resultCount: number;
  readonly evidenceCount: number;
  readonly artifactCount: number;
  readonly openedAt: number;
  readonly caseDigest: string;
  readonly foreignTenant: boolean;
}

/** The Arena surface: one row per decided escalation case. */
export interface ArenaView {
  readonly rows: readonly ArenaCaseRowView[];
  readonly totalCases: number;
  readonly ingestedCount: number;
  readonly foreignCount: number;
}

/**
 * Project escalation cases into the Arena view. Rows enumerate in the
 * runtime's own order (openedAt, caseId — content-derived, deterministic).
 */
export function projectArenaCases(
  cases: readonly ArenaEscalationCase[],
  viewer: LabViewer,
): ArenaView {
  const rows = [...cases]
    .sort((a, b) => a.openedAt - b.openedAt || String(a.caseId).localeCompare(String(b.caseId)))
    .map((useCase): ArenaCaseRowView => {
      const evidence = useCase.evidencePackage;
      return {
        caseId: String(useCase.caseId),
        tenant: String(useCase.tenant),
        decidedBy: String(useCase.decidedBy),
        sourceKind: String(useCase.sourceKind),
        requestKind: String(useCase.request.requestKind),
        lifecycleState: useCase.lifecycle.state,
        // The walked states from the record's own first `from` (empty
        // history ⇒ the record's current state IS the initial draft) —
        // append-only, E10; the trail is derived, never invented.
        lifecycleTrail: [
          useCase.lifecycle.history[0]?.from ?? useCase.lifecycle.state,
          ...useCase.lifecycle.history.map((step) => step.to),
        ].join(" > "),
        evidenceVerdict: evidence?.verdict ?? null,
        resultCount: evidence?.results.length ?? 0,
        evidenceCount: evidence?.evidence.length ?? 0,
        artifactCount: evidence?.artifacts.length ?? 0,
        openedAt: useCase.openedAt,
        caseDigest: String(useCase.caseDigest),
        foreignTenant: useCase.tenant !== viewer.tenant,
      } satisfies ArenaCaseRowView;
    });
  return {
    rows,
    totalCases: rows.length,
    ingestedCount: rows.filter((row) => row.lifecycleState === "ingested").length,
    foreignCount: rows.filter((row) => row.foreignTenant).length,
  } satisfies ArenaView;
}

/** Deterministic summary line ("N cases · M ingested · K foreign-tenant"). */
export function arenaSummary(view: ArenaView): string {
  const total = view.totalCases;
  const ingested = view.ingestedCount;
  const foreign = view.foreignCount;
  return `${total} escalation case${total === 1 ? "" : "s"} · ${ingested} ingested · ${foreign} foreign-tenant`;
}
