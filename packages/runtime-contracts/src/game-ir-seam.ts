/**
 * DOCUMENTED SEAM to `@playliquid/game-ir` (Work Order PL-001, in flight in
 * parallel at this base SHA).
 *
 * Per spec/module-dependency-matrix.md, runtime-contracts' only permitted
 * domain dependency is game-ir. Because the sibling package does not exist
 * yet at base b88e814, the minimal structural surfaces that runtime-contracts
 * needs are mirrored here, defined exactly against the FROZEN spec's GameIR
 * semantics (spec/architecture.md, "GameIR").
 *
 * TODO: bind to @playliquid/game-ir at graft time — replace each local type
 * below with the corresponding import from "@playliquid/game-ir" and delete
 * the mirror. Every mirrored symbol is listed here so the graft is a
 * mechanical, auditable replacement:
 *
 *   - GameIrDigest        -> game-ir's pinned game-composition digest type
 *   - WorldSchemaRef      -> game-ir's world topology/state-schema reference
 *   - AvatarDefinitionRef -> game-ir's avatar definition reference
 *   - RuntimePolicyRef    -> game-ir's runtime policy declaration reference
 *   - GameRefSummary      -> composed view used by session descriptors
 *
 * These mirrors are STRUCTURAL ONLY (opaque references + digests); no GameIR
 * semantics are re-implemented or duplicated here (lock rule 1: GameIR is the
 * semantic kernel — this package never becomes a second one).
 */

import type { Brand, Digest } from "./primitives.ts";

/**
 * Content digest of a fully pinned GameIR composition (game definition as
 * resolved through the package graph and game lockfile).
 *
 * TODO: bind to @playliquid/game-ir at graft time.
 */
export type GameIrDigest = Brand<string, "GameIrDigest">;

/**
 * Opaque reference to a world's static topology + mutable-state schema.
 * TODO: bind to @playliquid/game-ir at graft time.
 */
export interface WorldSchemaRef {
  readonly worldId: string;
  readonly revisionDigest: Digest;
}

/**
 * Opaque reference to an avatar definition (Body + Intelligence) inside the
 * pinned game composition. TODO: bind to @playliquid/game-ir at graft time.
 */
export interface AvatarDefinitionRef {
  readonly avatarId: string;
  readonly revisionDigest: Digest;
}

/**
 * Opaque reference to a runtime policy declaration (tick policy, budgets,
 * capability policy defaults) owned by GameIR.
 * TODO: bind to @playliquid/game-ir at graft time.
 */
export interface RuntimePolicyRef {
  readonly policyId: string;
  readonly revisionDigest: Digest;
}

/**
 * Composed, digest-pinned view of a game that a runtime session loads.
 * TODO: bind to @playliquid/game-ir at graft time.
 */
export interface GameRefSummary {
  readonly gameDigest: GameIrDigest;
  readonly world: WorldSchemaRef;
  readonly policy: RuntimePolicyRef;
}

/** Nominal cast: string -> GameIrDigest (seam-local constructor). */
export function asGameIrDigest(value: string): GameIrDigest {
  return value as GameIrDigest;
}
