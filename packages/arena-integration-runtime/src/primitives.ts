/**
 * Runtime-local primitive vocabulary for `@playliquid/arena-integration-runtime`
 * (PL-031).
 *
 * This package is the RUNTIME that executes decided capability-gap escalations
 * through `@playliquid/arena-integration`'s typed provider-neutral contract
 * layer (architecture.md §Arena; lock rules 6/32). It OWNS exactly one mutable
 * state: the tenant-scoped escalation-case table (plus the send/ingest receipt
 * ledgers arena-integration's oracles require a runtime owner for — see
 * lifecycle.ts/ingestion.ts there: "the Lab-side Arena runtime (PL-031) owns
 * the receipt store").
 *
 * Discipline kept from the consumed authorities:
 * - arena-integration owns the wire vocabulary (request/response envelopes,
 *   authorization scopes, lifecycle states, transport port). This package
 *   CONSUMES it; the only local vocabulary is case identity, refusal codes
 *   and the intake/registration record shapes.
 * - lab-contracts owns the gap ladder and the ArenaEscalationRef. This
 *   package never re-declares either.
 * - provider-neutrality (E3): no Arena vendor vocabulary exists here; the
 *   transport port is the only wire seam and real providers are host-side.
 *
 * Purity: no IO, no clock reads (time is caller-supplied or clock-port
 * supplied), no randomness. Digests are computed through the package-system
 * canonical-JSON authority (digest.ts).
 */

import type { Brand } from "@playliquid/game-contracts";
import { isValidIdText } from "@playliquid/game-contracts";

/** Identity of one tracked Arena escalation case (content-derived slug). */
export type ArenaCaseId = Brand<string, "ArenaCaseId">;

/** Registry key of one escalation source (content-derived slug). */
export type ArenaSourceKey = Brand<string, "ArenaSourceKey">;

/** Parses and validates `text` as an {@link ArenaCaseId}. */
export function asArenaCaseId(text: string): ArenaCaseId | undefined {
  return isValidIdText(text) ? (text as ArenaCaseId) : undefined;
}

/** Parses and validates `text` as an {@link ArenaSourceKey}. */
export function asArenaSourceKey(text: string): ArenaSourceKey | undefined {
  return isValidIdText(text) ? (text as ArenaSourceKey) : undefined;
}

/** The source kinds a decided escalation can cite (all rung-gated at intake). */
export type ArenaEscalationSourceKind = "gap-finding" | "gap-record" | "gap-summary";

/** All valid {@link ArenaEscalationSourceKind} values (frozen). */
export const ARENA_ESCALATION_SOURCE_KINDS: readonly ArenaEscalationSourceKind[] = Object.freeze([
  "gap-finding",
  "gap-record",
  "gap-summary",
]);

/** Returns true when `value` is a valid {@link ArenaEscalationSourceKind}. */
export function isArenaEscalationSourceKind(value: unknown): value is ArenaEscalationSourceKind {
  return typeof value === "string" && (ARENA_ESCALATION_SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Typed refusals of the escalation intake oracle (frozen vocabulary, kebab
 * case; the oracle is total — it never throws).
 *
 * - `invalid-command` — malformed ids/timestamps/kinds/scope in the command;
 * - `undecided-escalation` — no coherent host decision record (R18: the
 *   runtime NEVER auto-escalates; a decision that does not verify is no
 *   decision);
 * - `tampered-decision-digest` — the declared decision digest does not match
 *   the decision content (E8);
 * - `unknown-source` — the cited escalation source was never registered for
 *   the caller's tenant (the unknown-gap-finding refusal);
 * - `tampered-source` — a registered source no longer matches its
 *   content-addressed digest (E8);
 * - `rung-mismatch` — the source's gap-ladder rung is not the Arena rung
 *   (Arena is never a first resort — R18 / lock 32);
 * - `invalid-envelope` — the resolved arena-integration request envelope
 *   failed its own coherence oracle (reasons attached).
 *
 * Tenancy note: intake is structurally tenant-scoped (the oracle receives
 * the caller's tenant and only that tenant's registry view), so a foreign
 * source can only ever surface as `unknown-source` — cross-tenant refusals
 * are the read/drive doors' vocabulary (R20).
 */
export type ArenaIntakeRefusalCode =
  | "invalid-command"
  | "undecided-escalation"
  | "tampered-decision-digest"
  | "unknown-source"
  | "tampered-source"
  | "rung-mismatch"
  | "invalid-envelope";

/** All valid {@link ArenaIntakeRefusalCode} values (frozen). */
export const ARENA_INTAKE_REFUSAL_CODES: readonly ArenaIntakeRefusalCode[] = Object.freeze([
  "invalid-command",
  "undecided-escalation",
  "tampered-decision-digest",
  "unknown-source",
  "tampered-source",
  "rung-mismatch",
  "invalid-envelope",
]);

/**
 * Typed refusals of source registration (frozen vocabulary).
 * `invalid-source` carries the per-kind structural failure detail (including
 * lab-contracts gap-record validation violations). Registration is
 * structurally tenant-scoped (the source is filed under the CALLER's
 * tenant), so no cross-tenant code exists on this path.
 */
export type SourceRegistrationRefusalCode = "invalid-source";

/**
 * Typed refusals of case reads and the orchestration drive (frozen
 * vocabulary). Drive outcomes that are NOT refusals (transport errors,
 * policy denials, response rejections, expiries, terminal states) are
 * honest statuses, not failures — see service-types.ts.
 */
export type ArenaCaseRefusalCode =
  | "unknown-case"
  | "cross-tenant"
  | "tampered-case"
  | "tampered-document"
  | "no-persisted-document"
  | "audit-conflict"
  | "invalid-envelope"
  | "inconsistent-state"
  | "duplicate-send"
  | "send-collision"
  | "ingest-collision";

/** All valid {@link ArenaCaseRefusalCode} values (frozen). */
export const ARENA_CASE_REFUSAL_CODES: readonly ArenaCaseRefusalCode[] = Object.freeze([
  "unknown-case",
  "cross-tenant",
  "tampered-case",
  "tampered-document",
  "no-persisted-document",
  "audit-conflict",
  "invalid-envelope",
  "inconsistent-state",
  "duplicate-send",
  "send-collision",
  "ingest-collision",
]);
