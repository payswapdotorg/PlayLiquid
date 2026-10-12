/**
 * LATTICE — shared identity vocabulary (PL-039; examples/large-world).
 *
 * One world, one viewpoint agent, one canonical session and seed. Every
 * identifier is a canonical slug minted through the authoritative contracts
 * (game-contracts id grammar, runtime-contracts actor/session vocabulary) —
 * nothing is minted here.
 *
 * Digest formats differ across the seams this example bridges:
 * package-system digests are `sha256:<64 hex>`, runtime-contracts digests
 * are bare `<64 hex>`. {@link bareDigest} is the documented bridge (a pure
 * string projection, never a second digest authority — hashing always
 * happens inside the authority packages).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asCommitSha, asGameId } from "../../../packages/game-contracts/src/index.ts";
import type { GameId } from "../../../packages/game-contracts/src/index.ts";
import { asWorldId } from "../../../packages/game-contracts/src/index.ts";
import type { WorldId } from "../../../packages/game-contracts/src/index.ts";
import { asActorId } from "../../../packages/runtime-contracts/src/index.ts";

/** The game's slug (also the GameIR document id). */
export const LATTICE_ID: GameId = asGameId("lattice")!;

/** The large world this reference streams (§World). */
export const WORLD_ID: WorldId = asWorldId("world-lattice")!;

/** The tenant every build-orchestrator door is scoped to (R20). */
export const TENANT_NAME = "tenant-lattice" as const;

/** A second tenant used ONLY by the negative tenancy tests (R20). */
export const OTHER_TENANT_NAME = "tenant-elsewhere" as const;

/** The actor id of the viewpoint avatar-agent inside the runtime actor space. */
export const VIEWPOINT_ACTOR = asActorId("actor-viewpoint")!;

/** The canonical scripted session id (E9: fixed, never random). */
export const SESSION_ID = "sess-lattice-1" as const;

/** The determinism seed of the canonical streaming scenario (E9). */
export const CANONICAL_SEED = "lattice-seed-v1" as const;

/** A second seed used to prove seed sensitivity (E9). */
export const ALTERNATE_SEED = "lattice-seed-x9" as const;

/** Repository coordinates of the game's Git repository (R1). */
export const LATTICE_REPO = {
  host: "github.com",
  owner: "payswapdotorg",
  repository: "game-lattice",
} as const;

/**
 * A pinned commit of the game repository (a fixed 40-hex constant; E9
 * reproducibility forbids "whatever HEAD is right now").
 */
export const LATTICE_COMMIT = asCommitSha("2b7e151628aed2a6abf7158809cf4f3c762e7160")!;

/**
 * Projects a package-system digest (`sha256:<64 hex>`) onto the
 * runtime-contracts wire form (bare `<64 hex>`). Pure string projection;
 * refuses (returns `null`) non-matching input rather than guessing.
 */
export function bareDigest(packaged: string): string | null {
  if (!packaged.startsWith("sha256:") || packaged.length !== 71) {
    return null;
  }
  const hex = packaged.slice("sha256:".length);
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}
