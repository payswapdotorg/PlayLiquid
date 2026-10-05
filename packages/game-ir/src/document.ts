/**
 * The GameIR document: the engine-independent semantic kernel root (lock
 * rule 1). A document binds a game identity (R1) to a node graph and names
 * the entry scene.
 *
 * Pure module.
 */

import type { GameIdentity, GameLifecycleState, SceneRef } from "@playliquid/game-contracts";
import type { GameIRNode } from "./nodes.ts";

/**
 * GameIR document format version. Frozen at "1"; any change to the node or
 * value vocabulary requires a new version constant and an Architecture
 * Change Request.
 */
export type GameIRVersion = "1";

/** The current {@link GameIRVersion}. */
export const GAME_IR_VERSION: GameIRVersion = "1";

/** Returns true when `value` names a known {@link GameIRVersion}. */
export function isGameIRVersion(value: unknown): value is GameIRVersion {
  return value === GAME_IR_VERSION;
}

/** The root of a GameIR document. */
export type GameIRDocument = {
  readonly irVersion: GameIRVersion;
  readonly identity: GameIdentity;
  readonly lifecycle?: GameLifecycleState;
  readonly entry: SceneRef;
  readonly nodes: readonly GameIRNode[];
};
