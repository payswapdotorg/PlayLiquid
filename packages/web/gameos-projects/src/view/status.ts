/**
 * SHARED UI STATUS VOCABULARY (pure): the ONE mapping from the World
 * Projects read models' domain states to presentation tones. Every
 * chip/badge in the projects workbench renders through `UiStatus` —
 * components never re-derive tone from raw domain strings (E1 applied to
 * presentation; game-ui/gameos-lab/gameos-community precedent, status.ts).
 *
 * The pull-request lifecycle mapper mirrors the community workbench's
 * contribution mapper VERBATIM in tones and notes: the semantic-PR review
 * actions reuse the community package's frozen state machine
 * (submitted → triaged → under-review → accepted/rejected/withdrawn) and
 * never fork its vocabulary.
 *
 * Pure module: no IO, no React.
 */

/** Presentation tones the projects workbench components understand. */
export type UiTone = "ok" | "warn" | "error" | "neutral" | "info";

/** A mapped status: stable label + tone + (optional) explanatory note. */
export interface UiStatus {
  readonly label: string;
  readonly tone: UiTone;
  readonly note?: string;
}

/**
 * World content kind → status chip (game-contracts ACR-001 frozen
 * vocabulary: spark | game | experience | digital_twin | other — the
 * CONTENT axis, distinct from the delivery target-profile axis).
 */
export function worldKindStatus(worldKind: string): UiStatus {
  switch (worldKind) {
    case "spark":
      return { label: "spark", tone: "info", note: "World content kind: spark (ACR-001)" };
    case "game":
      return { label: "game", tone: "neutral", note: "World content kind: game (ACR-001)" };
    case "experience":
      return { label: "experience", tone: "info", note: "World content kind: experience (ACR-001)" };
    case "digital_twin":
      return { label: "digital twin", tone: "warn", note: "World content kind: digital_twin (ACR-001)" };
    case "other":
      return { label: "other", tone: "neutral", note: "World content kind: other (ACR-001)" };
    default:
      return { label: worldKind, tone: "neutral" };
  }
}

/**
 * Pull-request lifecycle status → status chip (community's frozen state
 * machine, reused verbatim — never forked: submitted → triaged →
 * under-review → the three terminal verdicts). Verdicts are terminal: a
 * closed pull request is never reopened (E10).
 */
export function pullRequestStatusStatus(status: string): UiStatus {
  switch (status) {
    case "submitted":
      return { label: "submitted", tone: "info", note: "awaiting maintainer triage" };
    case "triaged":
      return { label: "triaged", tone: "info", note: "queued for review" };
    case "under-review":
      return { label: "under review", tone: "warn", note: "maintainer review in progress" };
    case "accepted":
      return { label: "accepted", tone: "ok", note: "terminal (E10); corrected work is a new pull request" };
    case "rejected":
      return { label: "rejected", tone: "error", note: "terminal — corrected work is a new pull request" };
    case "withdrawn":
      return { label: "withdrawn", tone: "neutral", note: "pulled by the contributor; terminal" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Project task state → status chip (the project board's own tri-state). */
export function taskStatusStatus(status: string): UiStatus {
  switch (status) {
    case "open":
      return { label: "open", tone: "info", note: "not yet in review" };
    case "in-review":
      return { label: "in review", tone: "warn", note: "a semantic pull request addresses this task" };
    case "done":
      return { label: "done", tone: "ok", note: "landed on the default branch" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/**
 * Composition-pin release gate → status chip (package-system's R19
 * fail-closed provenance/licensing gate over the pinned record).
 */
export function gateStatusStatus(gate: string): UiStatus {
  if (gate === "pass") {
    return { label: "gate pass", tone: "ok", note: "the pinned package's release gate passed (R19)" };
  }
  return {
    label: "gate blocked",
    tone: "error",
    note: "the pinned package failed the release gate (R19 fail-closed)",
  };
}

/** Command intent receipt → status chip (E8: refusals are visible states). */
export function commandReceiptStatus(ok: boolean): UiStatus {
  return ok ? { label: "accepted", tone: "ok" } : { label: "refused", tone: "error" };
}

/** A typed refusal (selection, transition or load) → status chip; never silent. */
export function refusalStatus(code: string): UiStatus {
  return { label: code, tone: "error" };
}

/** Review-action availability note for one transition command button. */
export function transitionCommandStatus(command: string, legal: boolean): UiStatus {
  return legal
    ? { label: command, tone: "info", note: "legal from the current status (community state machine)" }
    : {
        label: command,
        tone: "neutral",
        note: "not legal from the current status — the frozen community state machine refuses it",
      };
}
