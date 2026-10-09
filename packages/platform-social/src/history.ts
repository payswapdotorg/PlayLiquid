/**
 * EVENT-SOURCED SOCIAL HISTORY (E10) — the append-only change records and
 * their game-ir evidence binding.
 *
 * Every relation change is admitted against EVENT EVIDENCE: a game-ir
 * canonical {@link GameEvent} (the game-declared semantic event that
 * caused the change) plus the game-side {@link SocialEventBinding} from
 * platform-contracts (lock 18: games bind THEIR events to the social
 * capability; they never mutate the graph themselves).
 *
 * The evidence digest is computed with game-ir's own canonical event
 * hashing (`hashEvent` over `canonicalEventForm`) — the same content
 * addressing the semantic kernel uses. One evidence digest can cause at
 * most ONE admitted change-set (E10): re-submission returns the
 * recorded receipt, never a second mutation.
 *
 * Records carry the `platform-authority` decidedBy marker: only the
 * social platform service decides graph facts.
 *
 * Purity: types + pure digest derivation. No IO.
 */

import { asContentDigest, asGameEventKind } from "@playliquid/platform-contracts";
import type { ContentDigest, PlatformAuthorityMarker, SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";
import type { SocialEventBinding } from "@playliquid/platform-contracts";
import { hashEvent, isGameIRValue } from "@playliquid/game-ir";
import type { GameEvent, GameIRValue } from "@playliquid/game-ir";

// ---------------------------------------------------------------------------
// Event evidence
// ---------------------------------------------------------------------------

/**
 * What a relation change was caused by: a game-declared semantic event
 * bound to the social capability, in game-ir canonical form.
 */
export interface SocialEventEvidence {
  readonly event: GameEvent;
  readonly binding: SocialEventBinding;
}

/**
 * Pure evidence validation + digest derivation. Returns `undefined`
 * when the evidence is malformed (payload not a GameIR value, event
 * type text outside the game-namespace grammar, or the binding's event
 * kind does not match the event's type — lock 18 discipline).
 */
export function evidenceDigestOf(evidence: SocialEventEvidence): ContentDigest | undefined {
  if (!isGameIRValue(evidence.event.payload)) return undefined;
  if (typeof evidence.event.type !== "string") return undefined;
  const boundKind = asGameEventKind(String(evidence.binding.eventKind));
  if (boundKind === undefined) return undefined;
  if (String(evidence.event.type) !== String(boundKind)) return undefined;
  return asContentDigest(hashEvent(evidence.event));
}

/** Convenience constructor for a record-shaped evidence payload. */
export function evidenceRecord(fields: Readonly<Record<string, string>>): GameIRValue {
  const record: Record<string, GameIRValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    record[key] = { kind: "string", value };
  }
  return { kind: "record", fields: record };
}

// ---------------------------------------------------------------------------
// Append-only change records (E10)
// ---------------------------------------------------------------------------

/** The directed relations the social graph tracks. */
export type SocialRelationKind = "follow" | "block";

/** Whether a relation edge was added or removed. */
export type SocialRelationChange = "added" | "removed";

/** One immutable, append-only relation change record. */
export interface SocialRelationChangeRecord {
  /** Deterministic: `${evidenceDigest}:${relation}:${change}`. */
  readonly recordId: string;
  readonly tenant: TenantId;
  readonly actor: SubjectId;
  readonly target: SubjectId;
  readonly relation: SocialRelationKind;
  readonly change: SocialRelationChange;
  readonly evidenceDigest: ContentDigest;
  readonly recordedAt: TimestampMs;
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Deterministic record id of one change (see {@link SocialRelationChangeRecord}). */
export function changeRecordId(
  evidenceDigest: ContentDigest,
  relation: SocialRelationKind,
  change: SocialRelationChange,
): string {
  return `${String(evidenceDigest)}:${relation}:${change}`;
}
