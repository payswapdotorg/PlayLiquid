/**
 * LUMEN RUN — the headless view model (PL-037).
 *
 * "The game is headless" (the README's honest scope statement): there is
 * no engine render surface in this example — the PlayCanvas binding is
 * cited as BUILD data (R12), never executed. What exists here is the
 * honest stand-in an experience can consume today: a pure, deterministic
 * TEXTUAL/STRUCTURAL projection of the authoritative world read model.
 *
 * Pure module: same world ⇒ same render, byte for byte (E9).
 */

import type { LumenRunWorld } from "./driver.ts";

/** The arena is a fixed 6×6 grid (mirrors the driver's bound). */
const BOUND = 5;

/** The structural view model (what an experience observes). */
export interface ArenaViewModel {
  readonly tick: number;
  readonly hero: { readonly col: number; readonly row: number; readonly lumens: number };
  readonly companion: { readonly col: number; readonly row: number };
  readonly motes: readonly { readonly id: string; readonly col: number; readonly row: number; readonly collected: boolean }[];
  readonly collectedCount: number;
  readonly completed: boolean;
}

/** Projects the world into the structural view model (pure). */
export function viewModelOf(world: LumenRunWorld): ArenaViewModel {
  return {
    tick: world.ticks,
    hero: { ...world.hero },
    companion: { ...world.companion },
    motes: world.motes.map((mote) => ({ id: mote.id, col: mote.baseCol, row: mote.row, collected: mote.collected })),
    collectedCount: world.motes.filter((mote) => mote.collected).length,
    completed: world.completed,
  };
}

/**
 * Renders the arena as a text grid (deterministic; useful in the harness
 * and in test failure messages). Rows render top (row 5) to bottom (row 0)
 * so the arena reads like a screen; cells: `H` hero, `C` companion,
 * `m` uncollected mote, `·` empty.
 */
export function renderArena(world: LumenRunWorld): string {
  const heroAt = (col: number, row: number): string =>
    world.hero.col === col && world.hero.row === row ? "H" : world.companion.col === col && world.companion.row === row ? "C" : "";
  const moteAt = (col: number, row: number): string => {
    const mote = world.motes.find((entry) => !entry.collected && entry.baseCol === col && entry.row === row);
    return mote === undefined ? "" : "m";
  };
  const lines: string[] = [];
  for (let row = BOUND; row >= 0; row -= 1) {
    const cells: string[] = [];
    for (let col = 0; col <= BOUND; col += 1) {
      const occupant = heroAt(col, row) || moteAt(col, row);
      cells.push(occupant === "" ? "·" : occupant);
    }
    lines.push(cells.join(" "));
  }
  lines.push(`tick ${String(world.ticks)} · lumens ${String(world.hero.lumens)} · motes ${String(world.motes.filter((m) => !m.collected).length)}/${String(world.motes.length)} · ${world.completed ? "run complete" : "in progress"}`);
  return lines.join("\n");
}
