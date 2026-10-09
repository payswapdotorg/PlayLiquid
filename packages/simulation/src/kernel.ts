/**
 * THE DETERMINISTIC SIMULATION KERNEL (the "systems" execution core).
 *
 * One kernel tick is a PURE function of: the tick number, the world state,
 * the commands due at that tick, the systems, and the RNG stream position.
 * The game's mechanics are supplied as {@link WorldSystem} values — pure
 * functions over {@link SystemTickInput} — mirroring the deterministic
 * evaluator contract of @playliquid/game-ir (evaluate.ts: same state value
 * in, same state + events out; the kernel adds the tick number, the
 * canonical command envelopes and the per-system forked RNG).
 *
 * Determinism strategy (E9), enforced by construction:
 * - systems run in DECLARED order (validated unique by systemId);
 * - each system receives an RNG forked deterministically from the tick RNG
 *   (`fork("tick:<tick>")` of the session root) with label
 *   `system:<systemId>` — so a system's random draws depend only on the
 *   root seed, the tick and the system id, never on execution timing;
 * - entities are iterated in sorted canonical key order inside systems
 *   (demo systems demonstrate the pattern);
 * - commands are applied in (dueTick, admission sequence) order.
 *
 * Lock rule 13: commands (already adjudicated through the capability
 * boundary and the canonical admission gate) mutate state via systems
 * here — this is the authoritative deterministic mutation point. The
 * kernel never renders, never performs IO, never reads a clock.
 *
 * Pure module.
 */

import type { EventCause, RuntimeCommandEnvelope, Tick } from "@playliquid/runtime-contracts";
import { asTick } from "@playliquid/runtime-contracts";
import type { GameEvent, GameIRValue } from "@playliquid/game-ir";
import type { RngPort } from "./ports.ts";
import type { WorldState } from "./world.ts";

/** What one system sees on one tick. */
export interface SystemTickInput {
  /** The kernel tick being computed (1-based within a run). */
  readonly tick: Tick;
  readonly state: WorldState;
  /** Commands due at this tick, in (dueTick, admission seq) order. */
  readonly commands: readonly RuntimeCommandEnvelope<GameIRValue>[];
  /** RNG forked for (this tick, this system) — deterministic sub-stream. */
  readonly rng: RngPort;
}

/** One event emitted by a system, with its canonical cause. */
export interface EmittedEvent {
  readonly event: GameEvent;
  readonly cause: EventCause;
}

/** What one system returns for one tick. */
export interface SystemTickOutput {
  readonly state: WorldState;
  readonly events: readonly EmittedEvent[];
}

/**
 * A game-defined deterministic mechanic. `systemId` must be unique within a
 * game binding (validated by {@link validateWorldSystems}).
 */
export interface WorldSystem {
  readonly systemId: string;
  readonly tick: (input: SystemTickInput) => SystemTickOutput;
}

/** Duplicate system ids would make run order ambiguous — refused. */
export function validateWorldSystems(systems: readonly WorldSystem[]): readonly string[] {
  const seen = new Set<string>();
  const violations: string[] = [];
  for (const system of systems) {
    if (system.systemId.length === 0) {
      violations.push("empty-system-id");
    } else if (seen.has(system.systemId)) {
      violations.push(`duplicate-system-id:${system.systemId}`);
    }
    seen.add(system.systemId);
  }
  return violations;
}

/** Aggregate kernel output for one tick. */
export interface KernelTickOutput {
  readonly state: WorldState;
  readonly events: readonly EmittedEvent[];
}

/** Input of {@link runKernelTick}: everything one tick depends on. */
export interface KernelTickInput {
  readonly tick: Tick;
  readonly state: WorldState;
  readonly commands: readonly RuntimeCommandEnvelope<GameIRValue>[];
  /** The tick RNG (typically `rootRng.fork("tick:<tick>")`). */
  readonly rng: RngPort;
  readonly systems: readonly WorldSystem[];
}

/**
 * Runs exactly one kernel tick: systems in declared order, each receiving
 * the evolving state, the due commands and its own deterministic RNG fork.
 * Events are collected in emission order (system order, then in-system
 * order). Pure with respect to the supplied RNG stream position.
 */
export function runKernelTick(input: KernelTickInput): KernelTickOutput {
  let state = input.state;
  const events: EmittedEvent[] = [];
  for (const system of input.systems) {
    const systemRng = input.rng.fork(`system:${system.systemId}`);
    const output = system.tick({
      tick: input.tick,
      state,
      commands: input.commands,
      rng: systemRng,
    });
    state = output.state;
    events.push(...output.events);
  }
  return { state, events };
}

/** Input of {@link runKernelTicks}: a consecutive fixed-tick span. */
export interface KernelRunInput {
  /** Tick number BEFORE the first step (the session's current tick). */
  readonly fromTick: number;
  /** How many ticks to advance (>= 1). */
  readonly ticks: number;
  readonly state: WorldState;
  /** The session root RNG (each tick forks `tick:<n>` from it). */
  readonly rng: RngPort;
  readonly systems: readonly WorldSystem[];
  /** Supplied by the session: drains everything due at or before `tick`. */
  readonly dueThrough: (tick: Tick) => readonly RuntimeCommandEnvelope<GameIRValue>[];
}

/** Aggregate output of {@link runKernelTicks}. */
export interface KernelRunOutput {
  readonly state: WorldState;
  /** The tick number after the last step (fromTick + ticks). */
  readonly toTick: number;
  /** Events in emission order across the whole span. */
  readonly events: readonly EmittedEvent[];
}

/**
 * Drives a consecutive span of fixed ticks through {@link runKernelTick}:
 * tick n+1..n+ticks, each seeing the state left by the previous one and the
 * commands due at its own tick (session scheduling order). This is the
 * whole deterministic stepping engine — batching (one step of N vs N steps
 * of 1) can never change the result (E9, tested).
 */
export function runKernelTicks(input: KernelRunInput): KernelRunOutput {
  let state = input.state;
  const events: EmittedEvent[] = [];
  for (let i = 0; i < input.ticks; i += 1) {
    const tickNumber = input.fromTick + i + 1;
    const output = runKernelTick({
      tick: asTick(tickNumber),
      state,
      commands: input.dueThrough(asTick(tickNumber)),
      rng: input.rng.fork(`tick:${tickNumber}`),
      systems: input.systems,
    });
    state = output.state;
    events.push(...output.events);
  }
  return { state, toTick: input.fromTick + input.ticks, events };
}
