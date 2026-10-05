/**
 * SEMANTIC EVENT VOCABULARY (lock rule 18 — THE core enforcement surface).
 *
 * "Games declare semantic events and policies; they do not duplicate
 * platform authorities."
 *
 * This module encodes that split in the type system itself:
 *
 * - {@link GameDeclaredEvent} — what a GAME may produce: a branded
 *   {@link GameEventKind} plus `origin: "game-declared"`. Games declare
 *   these events (in GameIR) and bind them to capabilities (per-capability
 *   binding types in this package); they never decide platform outcomes.
 * - {@link PlatformAuthorityEvent} — what only a PLATFORM SERVICE may
 *   emit: a frozen literal {@link PlatformAuthorityEventKind} plus the
 *   `origin: "platform-authority"` marker and `decidedBy` authority marker.
 *
 * The two shapes are structurally disjoint (`origin` literals differ; a
 * branded string is not assignable to the frozen literal union and vice
 * versa) — proven by `@ts-expect-error` type-misuse tests. The
 * `platform.` namespace is RESERVED: `asGameEventKind` refuses to mint a
 * game event kind inside it, and `validateCapabilityPolicy` (policy.ts)
 * rejects any game-declared event that carries a reserved kind.
 *
 * Purity: no IO; guards are structural checks over caller-supplied data.
 */

import type { Brand } from "@playliquid/game-contracts";

// ---------------------------------------------------------------------------
// Game-declared event kinds (branded, game namespace only)
// ---------------------------------------------------------------------------

/** Reserved namespace prefix for platform authority event kinds (lock 18). */
export const PLATFORM_EVENT_KIND_PREFIX = "platform.";

/** Event kind text: 1..6 dot-separated lowercase segments, each 1..32 chars. */
export const EVENT_KIND_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?){0,5}$/;

/** Returns true when `text` is syntactically valid event-kind text. */
export function isValidEventKindText(text: string): boolean {
  return text.length <= 127 && EVENT_KIND_PATTERN.test(text);
}

/** Returns true when `text` sits in the reserved platform namespace. */
export function isReservedPlatformEventKind(text: string): boolean {
  return text.startsWith(PLATFORM_EVENT_KIND_PREFIX);
}

/**
 * Branded game-declared semantic event kind (e.g. `"match.completed"`).
 * Constructed ONLY through {@link asGameEventKind}, which refuses both
 * malformed text and reserved platform-namespace kinds.
 */
export type GameEventKind = Brand<string, "GameEventKind">;

/**
 * Parses and validates `text` as a {@link GameEventKind}. Returns
 * `undefined` for malformed text AND for any kind in the reserved
 * `platform.` namespace — games cannot mint platform authority kinds.
 */
export function asGameEventKind(text: string): GameEventKind | undefined {
  if (!isValidEventKindText(text) || isReservedPlatformEventKind(text)) return undefined;
  return text as GameEventKind;
}

// ---------------------------------------------------------------------------
// Platform authority event kinds (frozen literal union)
// ---------------------------------------------------------------------------

/**
 * The frozen vocabulary of platform authority events. One entry per
 * platform capability lifecycle (R7 / lock 17). Games can OBSERVE these;
 * only platform services EMIT them (lock 18).
 */
export const PLATFORM_AUTHORITY_EVENT_KINDS = Object.freeze([
  "platform.leaderboard.rank.finalized",
  "platform.multiplayer.session.opened",
  "platform.multiplayer.outcome.decided",
  "platform.replay.artifact.sealed",
  "platform.entitlement.granted",
  "platform.entitlement.revoked",
  "platform.achievement.unlocked",
  "platform.social.relationship.changed",
  "platform.analytics.event.ingested",
  "platform.moderation.case.opened",
  "platform.moderation.report.rejected",
  "platform.integrity.report.issued",
] as const);

/** Literal union of every {@link PLATFORM_AUTHORITY_EVENT_KINDS} entry. */
export type PlatformAuthorityEventKind = (typeof PLATFORM_AUTHORITY_EVENT_KINDS)[number];

/** Returns true when `value` is a valid {@link PlatformAuthorityEventKind}. */
export function isPlatformAuthorityEventKind(value: unknown): value is PlatformAuthorityEventKind {
  return (
    typeof value === "string" &&
    (PLATFORM_AUTHORITY_EVENT_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Trust-domain markers
// ---------------------------------------------------------------------------

/**
 * Explicit marker every untrusted client payload is intersected with
 * (house pattern from `@playliquid/runtime-contracts`). The price of
 * admission for client data is acknowledging untrustedness; the marker
 * makes client payloads non-assignable to authoritative record types.
 */
export interface UntrustedClientInput {
  readonly untrusted: "untrusted-client-input";
}

// ---------------------------------------------------------------------------
// The two disjoint event shapes
// ---------------------------------------------------------------------------

/**
 * An event a GAME declared and emitted (lock 18). Never carries authority:
 * no rank, no grant, no verdict — those are platform-decided records that
 * CONSUME game events as evidence.
 */
export interface GameDeclaredEvent<P = unknown> {
  readonly origin: "game-declared";
  readonly kind: GameEventKind;
  readonly payload: P;
}

/**
 * An event only a platform service can emit. Carries BOTH the
 * `origin: "platform-authority"` literal and the `decidedBy` authority
 * marker, plus a kind from the frozen platform vocabulary.
 */
export interface PlatformAuthorityEvent<P = unknown> {
  readonly origin: "platform-authority";
  readonly kind: PlatformAuthorityEventKind;
  readonly decidedBy: "platform-authority";
  readonly payload: P;
}

/** Returns true when `value` is structurally a {@link GameDeclaredEvent}. */
export function isGameDeclaredEvent(value: unknown): value is GameDeclaredEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.origin === "game-declared" &&
    typeof event.kind === "string" &&
    isValidEventKindText(event.kind) &&
    !isReservedPlatformEventKind(event.kind)
  );
}

/** Returns true when `value` is structurally a {@link PlatformAuthorityEvent}. */
export function isPlatformAuthorityEvent(value: unknown): value is PlatformAuthorityEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.origin === "platform-authority" &&
    isPlatformAuthorityEventKind(event.kind) &&
    event.decidedBy === "platform-authority"
  );
}

// ---------------------------------------------------------------------------
// Game-side event declarations
// ---------------------------------------------------------------------------

/**
 * How a game DECLARES a semantic event in its platform policy: the kind
 * plus a human-readable summary. The summary is mandatory so GameIR
 * documents stay reviewable as text (R1: games are Git repositories).
 */
export interface GameSemanticEventDeclaration {
  readonly kind: GameEventKind;
  readonly summary: string;
}

/**
 * Structural guard for {@link GameSemanticEventDeclaration}. Shape-only:
 * accepts reserved-namespace kinds so that untrusted documents can be
 * inspected — the reserved-namespace RULE is a composition rule applied by
 * `validateCapabilityPolicy` (policy.ts), which reports it as the distinct
 * rejection code `reserved-platform-event-kind`.
 */
export function isGameSemanticEventDeclaration(value: unknown): value is GameSemanticEventDeclaration {
  if (typeof value !== "object" || value === null) return false;
  const declaration = value as Record<string, unknown>;
  return (
    typeof declaration.kind === "string" &&
    isValidEventKindText(declaration.kind) &&
    typeof declaration.summary === "string" &&
    declaration.summary.length > 0
  );
}
