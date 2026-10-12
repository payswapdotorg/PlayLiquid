/**
 * THE ADVERSARY KIT (PL-040 qa/e2e-lab) — shared assertion helpers for the
 * negative suites: every refusal must carry its TYPED code VERBATIM (E8) and
 * every idempotent replay must surface its FIRST receipt (E10).
 */

import assert from "node:assert/strict";
import type { HostileJournalEntry } from "./hostile-journal.ts";

/** A refusal-shaped result (the union's refused arm). */
export interface RefusedShape {
  readonly ok: false;
  readonly code: string;
  readonly detail: string;
}

/** A duplicate-shaped result (the refused arm carrying the first receipt). */
export interface DuplicateShape extends RefusedShape {
  readonly recorded?: unknown;
}

/**
 * Asserts the hostile result is refused with EXACTLY `code` (verbatim, E8)
 * and a non-empty detail. Returns the refusal (the refused arm of the
 * union) for further evidence checks.
 */
export function assertRefusedWith<
  R extends { readonly ok: boolean; readonly code?: string; readonly detail?: string },
>(result: R, code: string): Exclude<R, { ok: true }> & RefusedShape {
  assert.equal(result.ok, false, `the move was expected to be refused with ${code}`);
  const refused = result as unknown as Exclude<R, { ok: true }> & RefusedShape;
  assert.equal(refused.code, code, `E8: the refusal code must be "${code}" verbatim`);
  assert.ok(refused.detail.length > 0, "E8: the refusal carries a human-readable detail");
  return refused;
}

/**
 * Asserts the hostile result is an idempotent duplicate refusal with EXACTLY
 * `code` and its FIRST receipt attached (E10). Returns the duplicate.
 */
export function assertDuplicateWith<
  R extends { readonly ok: boolean; readonly code?: string; readonly detail?: string },
>(result: R, code: string): Exclude<R, { ok: true }> & DuplicateShape {
  const refused = assertRefusedWith(result, code) as unknown as Exclude<R, { ok: true }> & DuplicateShape;
  assert.ok(refused.recorded !== undefined, "E10: the first receipt is attached to the replay");
  return refused;
}

/**
 * A structural (JSON) deep copy — the adversary's tampering substrate: the
 * packages freeze their records, so a hostile edit starts from a copy.
 * Only for JSON-safe records (the Lab's folded learning records are;
 * raw run records carry bigint game-ir readings — spread-copy those).
 */
export function structuralCopyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Re-hydrates one journal entry array into a MUTABLE copy (tamper tests). */
export type MutableJournalEntry = {
  seq: number;
  at: number;
  step: string;
  facts: unknown;
  prevDigest: string;
  entryDigest: string;
};

/** Re-hydrates one journal entry array into a mutable copy (tamper tests). */
export function mutableEntriesOf(entries: readonly HostileJournalEntry[]): MutableJournalEntry[] {
  return entries.map((entry) => ({ ...entry, facts: JSON.parse(JSON.stringify(entry.facts)) }));
}

/** One step's recorded facts, cast to a plain record (the tests' read side). */
export function factsOf(entry: HostileJournalEntry | undefined): Record<string, unknown> {
  if (entry === undefined) throw new Error("adversary kit: the journal step was not recorded");
  return entry.facts as Record<string, unknown>;
}
