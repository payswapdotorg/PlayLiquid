/**
 * REPLAY PLATFORM SERVICE CONTRACTS (R7 / lock 17; R8 / lock 15).
 *
 * Replay is a first-class platform artifact. The platform service owns
 * capture sealing, cataloging, retention and access control. Games declare
 * which of their semantic events must be captured
 * ({@link ReplayEventBinding}, lock 18); the consumer list (players, QA,
 * integrity, simulation, Lab) is the frozen R8 vocabulary re-used from
 * `@playliquid/game-contracts`.
 *
 * Authority split: an artifact is only usable once SEALED by the platform
 * authority ({@link ReplayArtifactDescriptor.sealedBy}); unsealed or
 * cross-tenant reads are refused by {@link authorizeReplayAccess} with
 * typed negative codes (E8).
 *
 * Purity: pure types + pure guards + a pure access oracle. No IO, no
 * storage — the artifact store itself is a later Work Order (PL-011/014).
 */

import { isValidIdText, REPLAY_CONSUMERS } from "@playliquid/game-contracts";
import type { Brand, ReplayConsumer } from "@playliquid/game-contracts";
import type { MatchSessionId } from "./multiplayer.ts";
import type { SubjectId, TenantId, ContentDigest, PlatformAuthorityMarker } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";

/** Identifier of one sealed replay artifact (content-addressed world). */
export type ReplayId = Brand<string, "ReplayId">;

/** Parses and validates `text` as a {@link ReplayId}. */
export function asReplayId(text: string): ReplayId | undefined {
  return isValidIdText(text) ? (text as ReplayId) : undefined;
}

// ---------------------------------------------------------------------------
// Service policy + game-side event binding
// ---------------------------------------------------------------------------

/** Platform replay service behavior descriptor. */
export interface ReplayServicePolicy {
  readonly retentionDays: number;
  readonly verifyDeterminism: boolean;
  readonly sealOnFinalize: boolean;
}

/** Returns true when `value` is a structurally valid {@link ReplayServicePolicy}. */
export function isReplayServicePolicy(value: unknown): value is ReplayServicePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.retentionDays === "number" &&
    Number.isInteger(policy.retentionDays) &&
    policy.retentionDays >= 0 &&
    typeof policy.verifyDeterminism === "boolean" &&
    typeof policy.sealOnFinalize === "boolean"
  );
}

/**
 * How a game declares that one of ITS events must be captured into
 * replays (lock 18: declaration, not implementation).
 */
export interface ReplayEventBinding {
  readonly capability: "replay";
  readonly eventKind: GameEventKind;
}

/** Returns true when `value` is a structurally valid {@link ReplayEventBinding}. */
export function isReplayEventBinding(value: unknown): value is ReplayEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return binding.capability === "replay" && typeof binding.eventKind === "string" && binding.eventKind.length > 0;
}

// ---------------------------------------------------------------------------
// Artifact descriptor (catalog record)
// ---------------------------------------------------------------------------

/** A replay artifact as the platform catalog sees it. */
export interface ReplayArtifactDescriptor {
  readonly replayId: ReplayId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly session?: MatchSessionId;
  readonly capture: "intent-log" | "state-delta" | "full-state";
  readonly digest: ContentDigest;
  readonly consumers: readonly ReplayConsumer[];
  readonly sealedBy?: PlatformAuthorityMarker;
}

/** Returns true when `value` is a structurally valid {@link ReplayArtifactDescriptor}. */
export function isReplayArtifactDescriptor(value: unknown): value is ReplayArtifactDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  if (typeof descriptor.replayId !== "string" || descriptor.replayId.length === 0) return false;
  if (typeof descriptor.subject !== "string" || descriptor.subject.length === 0) return false;
  if (descriptor.capture !== "intent-log" && descriptor.capture !== "state-delta" && descriptor.capture !== "full-state") {
    return false;
  }
  if (typeof descriptor.digest !== "string" || !/^[0-9a-f]{64}$/.test(descriptor.digest)) return false;
  if (!Array.isArray(descriptor.consumers)) return false;
  if (!descriptor.consumers.every((consumer) => (REPLAY_CONSUMERS as readonly string[]).includes(consumer))) {
    return false;
  }
  if (descriptor.sealedBy !== undefined && descriptor.sealedBy !== "platform-authority") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Catalog queries + access oracle
// ---------------------------------------------------------------------------

/** A catalog query, always tenant-scoped (R20). */
export interface ReplayQueryRequest {
  readonly tenant: TenantId;
  readonly consumer: ReplayConsumer;
  readonly filter: { readonly subject?: SubjectId; readonly session?: MatchSessionId };
}

/** Returns true when `value` is a structurally valid {@link ReplayQueryRequest}. */
export function isReplayQueryRequest(value: unknown): value is ReplayQueryRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.consumer !== "string") return false;
  if (!(REPLAY_CONSUMERS as readonly string[]).includes(request.consumer)) return false;
  const filter = request.filter;
  if (typeof filter !== "object" || filter === null) return false;
  const record = filter as Record<string, unknown>;
  if (record.subject !== undefined && typeof record.subject !== "string") return false;
  if (record.session !== undefined && typeof record.session !== "string") return false;
  return true;
}

/** One page of catalog results. */
export interface ReplayCatalogPage {
  readonly artifacts: readonly ReplayArtifactDescriptor[];
}

/** Result of a replay access request. */
export type ReplayAccessDecision =
  | { readonly granted: true; readonly replayId: ReplayId }
  | {
      readonly granted: false;
      readonly code: "consumer-not-authorized" | "tenant-mismatch" | "artifact-not-sealed";
      readonly replayId: ReplayId;
    };

/**
 * Pure replay access oracle (R8 + R20 + E8). A read is granted only when
 * the requesting tenant owns the artifact, the consumer is in the
 * artifact's declared consumer list, and the artifact has been sealed by
 * the platform authority. Every refusal carries a typed code.
 */
export function authorizeReplayAccess(
  request: { readonly tenant: TenantId; readonly consumer: ReplayConsumer },
  artifact: ReplayArtifactDescriptor,
): ReplayAccessDecision {
  if (request.tenant !== artifact.tenant) {
    return { granted: false, code: "tenant-mismatch", replayId: artifact.replayId };
  }
  if (!artifact.consumers.includes(request.consumer)) {
    return { granted: false, code: "consumer-not-authorized", replayId: artifact.replayId };
  }
  if (artifact.sealedBy !== "platform-authority") {
    return { granted: false, code: "artifact-not-sealed", replayId: artifact.replayId };
  }
  return { granted: true, replayId: artifact.replayId };
}
