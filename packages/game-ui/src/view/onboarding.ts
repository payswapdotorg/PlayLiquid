/**
 * STUDIO ONBOARDING COPY + CONTEXTUAL NEXT STEPS (pure, UX-002): the ONE
 * owner of the first-run empty-state wording and the honest "what next"
 * lines of the Game Studio surfaces. Pure vocabulary module — same shape
 * as status.ts (no IO, no React, no clock), so the wording is testable at
 * the view layer and the panels render it verbatim (E1 applied to copy).
 *
 * Honesty rules (spec/ux/work-items.md frozen contract): every surface's
 * copy explains what PlayLiquid is / what the surface does in plain
 * product language, and names a REAL next step — `Refresh snapshot`
 * performs one authoritative pull through the `StudioDataPort`
 * (studio-store.refresh). Cross-workspace suggestions are PROSE
 * (navigation belongs to the desktop shell, not to this module), and
 * unsupported operations are marked "not yet supported" with the missing
 * prerequisite stated — never a fake button.
 */

/** The Studio surfaces that render a first-run empty state. */
export type StudioEmptySurfaceId = "packages" | "session" | "avatars" | "capabilities" | "tools";

/** The copy of one empty surface (rendered by components/empty-surface.tsx). */
export interface EmptySurfaceCopy {
  /** What is absent, in one short plain-language line. */
  readonly title: string;
  /** What this surface does (and what PlayLiquid is), plain product language. */
  readonly explanation: string;
  /** The label of the REAL next-step control (performs a supported operation). */
  readonly nextStepLabel: string;
  /** Extra prose lines: cross-workspace suggestions, honest limitations. */
  readonly guidance: readonly string[];
}

/**
 * The frozen empty-state copy per Studio surface. `Refresh snapshot` is the
 * REAL existing refresh control (one typed port pull) — the same operation
 * the header offers, offered again here as the discoverable first step.
 */
export const STUDIO_EMPTY_STATE_COPY: Readonly<Record<StudioEmptySurfaceId, EmptySurfaceCopy>> = Object.freeze(
  {
    packages: Object.freeze({
      title: "No packages yet",
      explanation:
        "PlayLiquid Game Studio reads your game's building blocks from the local package registry — worlds, assets, avatars, capabilities and tools, each with its provenance, license and release-gate verdict. The registry is empty on a first run, so there is nothing to show yet.",
      nextStepLabel: "Refresh snapshot",
      guidance: Object.freeze([
        "This surface is read-only: it projects what the registry has published. Publishing a package from Game Studio is not yet supported — the missing prerequisite is a publish control wired to the registry's publish door.",
        "To research what to build next, open the Lab workspace from the product top bar.",
      ]),
    }),
    session: Object.freeze({
      title: "No active runtime session",
      explanation:
        "The Session surface follows one live game runtime — its phase, epoch and tick, plus the append-only timeline of every operation (load, observe, act, step, snapshot, restore, replay, terminate). The desktop host composes no runtime session yet, so this is the honest empty state, not a failure.",
      nextStepLabel: "Refresh snapshot",
      guidance: Object.freeze([
        "Running a game from Game Studio is not yet supported — the missing prerequisite is a runtime session composed behind the Studio data port.",
      ]),
    }),
    avatars: Object.freeze({
      title: "No avatars composed",
      explanation:
        "Avatars are composed game entities — a body, referenced skill packages, sensor channels and the capabilities they may actually use under the host restriction. The desktop host composes no avatar definitions yet, so this surface starts empty.",
      nextStepLabel: "Refresh snapshot",
      guidance: Object.freeze([
        "Creating or importing an avatar from Game Studio is not yet supported — the missing prerequisite is an avatar-composition operation wired through a Studio port.",
      ]),
    }),
    capabilities: Object.freeze({
      title: "No capabilities declared",
      explanation:
        "Capabilities are what avatars and agents are allowed to do; the Capability Broker is the single permission authority that authorizes each intent. This surface reads the broker's live policy, grant table and tracked evaluations. The desktop host declares an empty coverage policy, so no capability is listed yet.",
      nextStepLabel: "Refresh snapshot",
      guidance: Object.freeze([
        "Model, agent and provider configuration lives in the AI & Agents workspace, reachable from the product top bar.",
      ]),
    }),
    tools: Object.freeze({
      title: "No tools registered",
      explanation:
        "Tools are engine and DCC integrations registered with the Tool Fabric — adapters with lifecycle states, durable jobs and a job-event timeline. The desktop host registers no engine adapters yet, so this surface starts empty.",
      nextStepLabel: "Refresh snapshot",
      guidance: Object.freeze([
        "Registering or dispatching a tool from Game Studio is not yet supported — the missing prerequisite is a registered adapter behind the tool-fabric runtime.",
      ]),
    }),
  } satisfies Record<StudioEmptySurfaceId, EmptySurfaceCopy>,
);

/**
 * The honest "what next" line after a refresh failure (rendered under the
 * E11 banner). Null when no failure is recorded — the line never invents a
 * state (E11: the failure itself is the banner's job, this is only the next
 * step).
 */
export function refreshFailureNextStep(loadError: string | null): string | null {
  if (loadError === null) return null;
  return "What next: the last good snapshot above still renders — nothing was dropped. Choose Refresh snapshot to pull the authoritative read models again; the recorded error stays until a pull succeeds.";
}

/**
 * The short "what you can do next" hint under the operation timeline once
 * operations are recorded (the timeline grew). Null while empty — the
 * surface's empty state covers that case.
 */
export function timelineNextHint(recordedOperations: number): string | null {
  if (recordedOperations <= 0) return null;
  const label = recordedOperations === 1 ? "operation" : "operations";
  return `What you can do next: the timeline is append-only — the ${String(recordedOperations)} recorded ${label} stay in order and are never rewritten. Choose Refresh snapshot to pull the latest authoritative operations.`;
}
