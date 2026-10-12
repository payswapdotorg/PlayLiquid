/**
 * SHARED UI STATUS VOCABULARY (pure): the ONE mapping from the Community
 * read models' domain states to presentation tones. Every chip/badge in
 * the Community workbench renders through `UiStatus` — components never
 * re-derive tone from raw domain strings (E1 applied to presentation;
 * game-ui/gameos-lab precedent, status.ts).
 *
 * The E8 trust model is visible HERE: every contribution that has not
 * passed the accept-time qualification gate renders through a trust chip
 * that says "untrusted" outright — third-party contributions are
 * untrusted until qualified, and the UI never renders otherwise.
 *
 * Pure module: no IO, no React.
 */

/** Presentation tones the Community workbench components understand. */
export type UiTone = "ok" | "warn" | "error" | "neutral" | "info";

/** A mapped status: stable label + tone + (optional) explanatory note. */
export interface UiStatus {
  readonly label: string;
  readonly tone: UiTone;
  readonly note?: string;
}

/**
 * Contribution lifecycle status → status chip (community's frozen state
 * machine: submitted → triaged → under-review → the three terminal
 * verdicts). Verdicts are terminal: a closed contribution is never
 * reopened (E10).
 */
export function contributionStatusStatus(status: string): UiStatus {
  switch (status) {
    case "submitted":
      return { label: "submitted", tone: "info", note: "awaiting maintainer triage" };
    case "triaged":
      return { label: "triaged", tone: "info", note: "queued for review" };
    case "under-review":
      return { label: "under review", tone: "warn", note: "maintainer review in progress" };
    case "accepted":
      return { label: "accepted", tone: "ok", note: "qualified at accept; terminal (E10)" };
    case "rejected":
      return { label: "rejected", tone: "error", note: "terminal — corrected work is a new submission" };
    case "withdrawn":
      return { label: "withdrawn", tone: "neutral", note: "pulled by the contributor; terminal" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Contribution kind → status chip (community's frozen twelve kinds). */
export function contributionKindStatus(kind: string): UiStatus {
  return { label: kind, tone: "neutral", note: "architecture §Community contribution kind" };
}

/**
 * The E8 trust state of one contribution: untrusted until the accept-time
 * qualification gate passes. Accepted ⇒ qualified (the gate ran at accept);
 * anything else ⇒ untrusted, rendered honestly.
 */
export function trustStatus(trust: string): UiStatus {
  if (trust === "qualified-at-accept") {
    return { label: "qualified at accept", tone: "ok", note: "the accept-time qualification gate passed (E8)" };
  }
  return {
    label: "untrusted until qualified",
    tone: "warn",
    note: "third-party contributions are untrusted until qualified at accept (E8)",
  };
}

/** AI disclosure → status chip (lock 11: provenance is first-class). */
export function aiDisclosureStatus(aiGenerated: boolean): UiStatus {
  return aiGenerated
    ? { label: "AI-assisted · disclosed", tone: "info", note: "model provenance entries recorded" }
    : { label: "no AI use declared", tone: "neutral" };
}

/** Origin kind → status chip (first-party original vs lineage-derived). */
export function originStatus(originKind: string): UiStatus {
  return originKind === "lineage-derived"
    ? { label: "lineage-derived", tone: "info", note: "cites a content-addressed git-lineage base" }
    : { label: "original", tone: "neutral", note: "first-party work" };
}

/** R18 gap linkage → status chip. */
export function gapLinkStatus(linked: boolean): UiStatus {
  return linked
    ? { label: "gap-linked", tone: "info", note: "addresses a Lab-recorded capability gap (R18)" }
    : { label: "unlinked", tone: "neutral" };
}

/** Command intent receipt → status chip (E8: refusals are visible states). */
export function commandReceiptStatus(ok: boolean): UiStatus {
  return ok
    ? { label: "accepted", tone: "ok" }
    : { label: "refused", tone: "error" };
}

/** A typed refusal (selection or load) → status chip; never silent. */
export function refusalStatus(code: string): UiStatus {
  return { label: code, tone: "error" };
}

/** Workflow transition row → status chip over its target state. */
export function transitionStatus(to: string): UiStatus {
  return contributionStatusStatus(to);
}
