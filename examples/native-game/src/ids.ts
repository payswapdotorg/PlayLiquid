/**
 * LUMEN RUN — shared identity vocabulary (PL-037).
 *
 * One tenant, three subjects, one session id, one repository identity
 * (R1: games are Git repositories). Every identifier is a canonical
 * slug from the authoritative contracts (game-contracts id grammar /
 * platform-contracts tenancy primitives, R20) — nothing is minted here.
 *
 * Digest formats differ across the seams this example bridges:
 * package-system digests are `sha256:<64 hex>`, platform-contracts
 * digests are bare `<64 hex>`. {@link bareDigest} is the documented
 * bridge between the two wire formats (a projection, never a second
 * digest authority — the hashing itself always happens inside the
 * authority packages).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asCommitSha, asGameId } from "../../../packages/game-contracts/src/index.ts";
import type { GameId } from "../../../packages/game-contracts/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import type { SubjectId, TenantId, ContentDigest } from "../../../packages/platform-contracts/src/index.ts";

/** The game's slug (also the GameIR document id). */
export const LUMEN_RUN_ID: GameId = asGameId("lumen-run")!;

/** The tenant every platform service in the example is scoped to (R20). */
export const TENANT: TenantId = asTenantId("tenant-lumen-run")!;

/** A second tenant used ONLY by the negative tenancy tests. */
export const OTHER_TENANT: TenantId = asTenantId("tenant-elsewhere")!;

/** The primary player subject. */
export const PLAYER_ONE: SubjectId = asSubjectId("player-one")!;

/** A second player (social edge target, leaderboard peer). */
export const PLAYER_TWO: SubjectId = asSubjectId("player-two")!;

/** The platform operator subject that administers service registrations. */
export const OPERATOR: SubjectId = asSubjectId("operator-lumen")!;

/** The avatar-agent actor id (the hero's AI companion). */
export const COMPANION_ACTOR = "actr-companion" as const;

/** The canonical scripted session id (E9: fixed, never random). */
export const SESSION_ID = "sess-lumen-run-1" as const;

/** The replay record slug the integrity evaluation cites (R8). */
export const REPLAY_ID = "replay-lumen-run-1" as const;

/** Repository coordinates of the game's Git repository (R1). */
export const LUMEN_RUN_REPO = {
  host: "github.com",
  owner: "payswapdotorg",
  repository: "game-lumen-run",
} as const;

/**
 * A pinned commit of the game repository. A fixed 40-hex constant (the
 * composition is versioned data; E9 reproducibility forbids "whatever
 * HEAD is right now").
 */
export const LUMEN_RUN_COMMIT = asCommitSha("0f01a2b3c4d5e6f708192a3b4c5d6e7f80912a3b")!;

/** The determinism seed of the canonical scripted playthrough (E9). */
export const CANONICAL_SEED = "lumen-run-seed-v1" as const;

/**
 * Projects a package-system digest (`sha256:<64 hex>`) onto the
 * platform-contracts wire form (bare `<64 hex>`). Pure string
 * projection; refuses (returns `null`) non-matching input rather than
 * guessing.
 */
export function bareDigest(packaged: string): ContentDigest | null {
  if (!packaged.startsWith("sha256:") || packaged.length !== 71) {
    return null;
  }
  const hex = packaged.slice("sha256:".length);
  return /^[0-9a-f]{64}$/.test(hex) ? (hex as ContentDigest) : null;
}
