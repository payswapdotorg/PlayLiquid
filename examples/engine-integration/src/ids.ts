/**
 * FORGE — shared identity vocabulary (PL-038; examples/engine-integration).
 *
 * One tenant, one game composition, one asset authoring tool, three engine
 * adapters, one canonical workflow. Every identifier is either a canonical
 * slug from the authoritative contracts (game-contracts id grammar /
 * platform-contracts tenancy primitives, R20) or an explicit E9 constant —
 * nothing here is minted from a clock, a random source or ambient state.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asCommitSha, asGameId } from "../../../packages/game-contracts/src/index.ts";
import type { GameId } from "../../../packages/game-contracts/src/index.ts";
import { asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import type { TenantId } from "../../../packages/platform-contracts/src/index.ts";

/** The game's slug (also the GameIR document id and the registry prefix). */
export const FORGE_GAME_ID: GameId = asGameId("forge")!;

/** The tenant every adapter, registry and build door is scoped to (R20). */
export const FORGE_TENANT: TenantId = asTenantId("tenant-forge")!;

/** A second tenant used ONLY by the negative tenancy tests (R20). */
export const OTHER_TENANT: TenantId = asTenantId("tenant-elsewhere")!;

/** The canonical workflow id (E9: fixed, never random). */
export const WORKFLOW_ID = "forge-engine-workflow-1" as const;

/** The idempotency material of the canonical build request (E6/E9). */
export const BUILD_REQUESTER = "forge-build-officer" as const;
export const BUILD_NONCE = "forge-canonical-build-1" as const;

/** The Blender project the authoring stage works against. */
export const BLENDER_PROJECT = "forge-assets.blend" as const;
/** The scene inside that project the assets import into. */
export const BLENDER_SCENE = "Scene" as const;
/** The Unreal project the engine build stage cooks and packages. */
export const UNREAL_PROJECT = "ForgeGame" as const;

/** The determinism seeds of the four adapters' fake bridges (E9). */
export const BLENDER_BRIDGE_SEED = 20250338;
export const UNREAL_BRIDGE_SEED = 20250322;
export const UNITY_BRIDGE_SEED = 20250323;
export const GODOT_BRIDGE_SEED = 20250324;

/** The injected-clock origin every service in the workflow shares (E9). */
export const WORKFLOW_CLOCK_ORIGIN_MS = 1_700_000_000_000;

/** The repository coordinates of the game's Git repository (R1). */
export const FORGE_REPO = {
  host: "github.com",
  owner: "payswapdotorg",
  repository: "game-forge",
} as const;

/** A pinned commit of the game repository (E9: versioned data, never HEAD). */
export const FORGE_COMMIT = asCommitSha("3f01a2b3c4d5e6f708192a3b4c5d6e7f80912a3b")!;

/** The namespace every registered tool publishes under. */
export const TOOL_NAMESPACE = "playliquid.forge" as const;

/** The surface version every registration and call cites (mediated by the pipeline). */
export const TOOL_SURFACE = { major: 1, minor: 0 } as const;

/** The schema shapes the fabric pipeline validates calls against. */
export const BLENDER_INPUT_SHAPE = { shapeId: "playliquid.forge/blender-command", revision: 1 } as const;
export const BLENDER_OUTPUT_SHAPE = { shapeId: "playliquid.forge/blender-result", revision: 1 } as const;
export const ENGINE_INPUT_SHAPE = { shapeId: "playliquid.forge/engine-command", revision: 1 } as const;
export const ENGINE_OUTPUT_SHAPE = { shapeId: "playliquid.forge/engine-result", revision: 1 } as const;

/** The capabilities the fabric grants the workflow (mediation; R13). */
export const GRANTED_CAPABILITIES = ["forge.author", "forge.build"] as const;

/** The provider-neutral tool operations the canonical toolchain cites. */
export const TOOLCHAIN_OPERATIONS = ["cook", "validate", "package"] as const;

/** The fixed media type of every sealed receipt artifact (E7). */
export const RECEIPT_MEDIA_TYPE = "application/json" as const;
