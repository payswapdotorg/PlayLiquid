/**
 * LUMEN RUN — the world driver (PL-037): where game simulation logic
 * plugs into the Interactive Runtime kernel (the WorldDriver seam of
 * PL-013, world.ts: "a driver is supplied by the game").
 *
 * Authority split (E1/E2): the KERNEL owns the session machine; THIS
 * driver owns Lumen Run semantics — how the world instantiates from the
 * GameIR document + seed, how an admitted command mutates the world and
 * what happens per fixed tick. The world state is JSON-safe (snapshots
 * are byte-stable, E9); event effects carry GameIR-value payloads (R14).
 *
 * Determinism contract (E9): the driver is a pure function of
 * (world, command|tick, seed) — no clocks, no IO, no globals. The same
 * seed always produces the same trajectory.
 *
 * Gameplay: a 6×6 arena; the hero collects lumen motes that drift on a
 * seeded ping-pong pattern; a collection is any uncollected mote within
 * Chebyshev distance 1 of the hero; collecting the last mote seals the
 * vault and completes the run with score 300 − 10 × ticks.
 */

import type { GameIRDocument, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { asEventKind } from "../../../packages/runtime-contracts/src/index.ts";
import type { CommandKind, CommandAdmissionPolicy, DeterminismSeed, RuntimeCommandEnvelope, RuntimeSessionDescriptor, Tick } from "../../../packages/runtime-contracts/src/index.ts";
import type { WorldDriver, WorldEventEffect, WorldStep } from "../../../packages/runtime-core/src/index.ts";
import { COMMAND_KINDS, EVENT_TYPES, fromWire } from "./events.ts";
import { moteDriftedPayload, movedPayload, heroLookedPayload, lumenCollectedPayload, runCompletedPayload } from "./events.ts";
import { HERO_ENTITY, COMPANION_ENTITY, MOTE_ENTITIES } from "./document.ts";

/** Arena bound: cells are [0,5]×[0,5]. */
const BOUND = 5;
/** The game's world identity (recorded in snapshot payloads). */
export const LUMEN_RUN_WORLD_KIND = "examples.native-game/lumen-run@1";

/** One drifting lumen mote. */
type MoteState = {
  readonly id: string;
  readonly baseCol: number;
  readonly row: number;
  readonly phase: number;
  collected: boolean;
};

/**
 * The JSON-safe world state (E9: canonical bytes are byte-stable). A type
 * alias (not an interface) so it structurally satisfies runtime-core's
 * JsonSafeValue record variant — snapshots need byte-stable worlds.
 */
export type LumenRunWorld = {
  readonly hero: { readonly col: number; readonly row: number; readonly lumens: number };
  readonly companion: { readonly col: number; readonly row: number };
  readonly motes: readonly MoteState[];
  readonly completed: boolean;
  readonly ticks: number;
};

const clamp = (value: number): number => Math.min(BOUND, Math.max(0, value));
const chebyshev = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** Game-local deterministic seed offset (the seed's gameplay effect, E9). */
function seedOffset(seed: DeterminismSeed | undefined): number {
  if (seed === undefined) return 0;
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) {
    acc = (acc + seed.charCodeAt(i) * (i + 1)) % 13;
  }
  return acc;
}

function intField(value: GameIRValue | undefined, field: string): number {
  if (value?.kind === "int") return Number(value.value);
  throw new Error(`lumen-run driver: payload field ${field} must be an int value`);
}

/** Reads a cell payload {col:int, row:int} from the value language. */
export function readCell(payload: unknown): { col: number; row: number } {
  if (typeof payload !== "object" || payload === null || (payload as GameIRValue).kind !== "record") {
    throw new Error("lumen-run driver: move payload must be a record value");
  }
  const fields = (payload as Extract<GameIRValue, { kind: "record" }>).fields;
  return { col: intField(fields.col, "col"), row: intField(fields.row, "row") };
}

/** Instantiates the initial world FROM the GameIR document (GameIR-direct). */
export function initialLumenRunWorld(document: GameIRDocument, seed: DeterminismSeed | undefined): LumenRunWorld {
  const offset = seedOffset(seed);
  const entity = (id: string): GameIRValue => {
    const node = document.nodes.find((entry) => entry.kind === "entity" && entry.entity === id);
    if (node?.kind !== "entity") throw new Error(`lumen-run driver: entity ${id} missing from the document`);
    return node.state;
  };
  const cellOf = (id: string) => {
    const state = entity(id);
    if (state.kind !== "record") throw new Error(`lumen-run driver: entity ${id} state is not a record`);
    return readCell(state);
  };
  const heroCell = cellOf(HERO_ENTITY);
  const companionCell = cellOf(COMPANION_ENTITY);
  const motes: MoteState[] = MOTE_ENTITIES.map((id, index) => {
    const cell = cellOf(id);
    return { id, baseCol: cell.col, row: cell.row, phase: (index + offset) % 2, collected: false };
  });
  return {
    hero: { col: heroCell.col, row: heroCell.row, lumens: 0 },
    companion: { col: companionCell.col, row: companionCell.row },
    motes,
    completed: false,
    ticks: 0,
  };
}

/** The pure mote drift rule: seeded ping-pong between base and base+1. */
export function moteColumn(mote: MoteState, tick: number): number {
  return clamp(mote.baseCol + ((tick + mote.phase) % 2 === 0 ? 0 : 1));
}

/**
 * THE Lumen Run driver. One instance per kernel construction; carries the
 * document (static content) and nothing mutable — all state lives in the
 * world the kernel hands back and forth.
 */
export class LumenRunDriver implements WorldDriver<LumenRunWorld> {
  readonly worldKind = LUMEN_RUN_WORLD_KIND;
  readonly commandPolicy: CommandAdmissionPolicy = {
    [COMMAND_KINDS.heroMove]: ["ready", "running"],
    [COMMAND_KINDS.heroLook]: ["ready", "running"],
    [COMMAND_KINDS.companionMove]: ["ready", "running"],
  };

  private readonly doc: GameIRDocument;

  constructor(document: GameIRDocument) {
    // A plain field (not a parameter property): node's strip-only TS mode
    // runs this file directly, and parameter properties need transforms.
    this.doc = document;
  }

  initialWorld(_descriptor: RuntimeSessionDescriptor, seed: DeterminismSeed | undefined): LumenRunWorld {
    return initialLumenRunWorld(this.doc, seed);
  }

  intentToCommandKind(intentKind: string): CommandKind | undefined {
    if (
      intentKind === COMMAND_KINDS.heroMove ||
      intentKind === COMMAND_KINDS.heroLook ||
      intentKind === COMMAND_KINDS.companionMove
    ) {
      return intentKind as CommandKind;
    }
    return undefined;
  }

  applyCommand(world: LumenRunWorld, command: RuntimeCommandEnvelope, tick: Tick): WorldStep<LumenRunWorld> {
    if (command.kind === COMMAND_KINDS.heroLook) {
      const visible = world.motes.filter((mote) => !mote.collected).length;
      return { world, effects: [{ kind: asEventKind(EVENT_TYPES.heroLooked), payload: heroLookedPayload(visible, tick) }] };
    }
    const cell = readCell(fromWire(command.payload));
    if (command.kind === COMMAND_KINDS.heroMove) {
      return this.applyHeroMove(world, clamp(cell.col), clamp(cell.row), tick);
    }
    if (command.kind === COMMAND_KINDS.companionMove) {
      const next: LumenRunWorld = {
        ...world,
        companion: { col: clamp(cell.col), row: clamp(cell.row) },
      };
      return { world: next, effects: [{ kind: asEventKind(EVENT_TYPES.companionMoved), payload: movedPayload(next.companion.col, next.companion.row, tick) }] };
    }
    throw new Error(`lumen-run driver cannot apply command kind ${String(command.kind)}`);
  }

  tickWorld(world: LumenRunWorld, tick: Tick, _seed: DeterminismSeed | undefined): WorldStep<LumenRunWorld> {
    const effects: WorldEventEffect<GameIRValue>[] = [];
    for (const mote of world.motes) {
      if (mote.collected) continue;
      const col = moteColumn(mote, tick);
      effects.push({ kind: asEventKind(EVENT_TYPES.moteDrifted), payload: moteDriftedPayload(mote.id, col, mote.row, tick) });
    }
    return { world: { ...world, ticks: tick }, effects };
  }

  private applyHeroMove(world: LumenRunWorld, col: number, row: number, tick: Tick): WorldStep<LumenRunWorld> {
    const effects: WorldEventEffect<GameIRValue>[] = [
      { kind: asEventKind(EVENT_TYPES.heroMoved), payload: movedPayload(col, row, tick) },
    ];
    let lumens = world.hero.lumens;
    const motes = world.motes.map((mote) => {
      if (mote.collected || chebyshev(col, row, moteColumn(mote, tick), mote.row) > 1) return mote;
      lumens += 1;
      effects.push({ kind: asEventKind(EVENT_TYPES.lumenCollected), payload: lumenCollectedPayload(mote.id, lumens, tick) });
      return { ...mote, collected: true };
    });
    let next: LumenRunWorld = {
      ...world,
      hero: { col, row, lumens },
      motes,
    };
    if (!world.completed && motes.every((mote) => mote.collected)) {
      const score = Math.max(0, 300 - 10 * tick);
      effects.push({ kind: asEventKind(EVENT_TYPES.vaultSealed), payload: { kind: "unit" } });
      effects.push({ kind: asEventKind(EVENT_TYPES.runCompleted), payload: runCompletedPayload(score, lumens, tick) });
      next = { ...next, completed: true };
    }
    return { world: next, effects };
  }
}
