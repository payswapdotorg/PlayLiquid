/**
 * THE WORLD DRIVER SEAM — where game simulation logic plugs into the
 * Interactive Runtime kernel.
 *
 * Division of authority (spec/architecture.md "Runtime"; lock rule 12):
 *
 * - The KERNEL (kernel.ts) owns the session machine: phases, epochs,
 *   sequences, the canonical command/event path, idempotency, snapshots and
 *   the Experience Protocol surface. It owns NO game semantics.
 * - The DRIVER owns game/world semantics: how a world instantiates from a
 *   descriptor + seed, how an admitted command mutates the world, and what
 *   happens per fixed tick. A driver is supplied by the game (ultimately
 *   bound to GameIR system declarations by later work orders); this package
 *   ships only the seam plus test-support reference drivers (fakes.ts).
 *
 * Determinism contract (E9): a driver MUST be a pure function of
 * (world, command|tick, seed). Given the same world state and the same
 * inputs it must produce the same next world and the same event effects in
 * the same order. The kernel enforces determinism of everything it owns
 * (fixed-tick stepping, deterministic event ids, canonical snapshot bytes);
 * the driver supplies the rest. Drivers must NOT read clocks, perform IO,
 * or consult global state.
 *
 * Purity: types only in this module — no runtime behavior is defined here.
 */

import type {
  CommandAdmissionPolicy,
  CommandKind,
  DeterminismSeed,
  EventKind,
  RuntimeCommandEnvelope,
  RuntimeSessionDescriptor,
  Tick,
} from "@playliquid/runtime-contracts";

/**
 * One observable effect a driver wants on the canonical event path. The
 * kernel wraps effects into `RuntimeEventEnvelope`s: it assigns the event
 * id, the global sequence number, the session id and the tick, and derives
 * the causal provenance (`command` for effects produced while applying a
 * command, `system` for per-tick effects).
 */
export interface WorldEventEffect<P = unknown> {
  readonly kind: EventKind;
  readonly payload: P;
}

/** Result of one pure driver step (command application or tick). */
export interface WorldStep<W> {
  readonly world: W;
  readonly effects: readonly WorldEventEffect[];
}

/**
 * The pure game-simulation seam. `W` is the driver's world state type; it
 * must be JSON-safe (see serialize.ts) so snapshots are byte-stable.
 */
export interface WorldDriver<W> {
  /** Stable label recorded in snapshot payloads (world identity). */
  readonly worldKind: string;

  /** Admissible command kinds -> the session phases that admit them (E2). */
  readonly commandPolicy: CommandAdmissionPolicy;

  /** Instantiate the initial world (pure; seed drives initial variance). */
  initialWorld(descriptor: RuntimeSessionDescriptor, seed: DeterminismSeed | undefined): W;

  /** Apply one ADMITTED command to the world (pure). */
  applyCommand(world: W, command: RuntimeCommandEnvelope, tick: Tick): WorldStep<W>;

  /** Advance the world by exactly one fixed tick (pure). */
  tickWorld(world: W, tick: Tick, seed: DeterminismSeed | undefined): WorldStep<W>;

  /**
   * Map an intent kind to the command kind it drives. GAME-SIDE
   * declaration, used by the kernel only for direct-origin commands
   * (player/platform-system/host-authority actors). Grant-mediated
   * (avatar-agent) commands are derived broker-side (PL-026).
   */
  intentToCommandKind(intentKind: string): CommandKind | undefined;
}
