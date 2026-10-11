/**
 * SHARED UI STATUS VOCABULARY (pure): the ONE mapping from domain states to
 * presentation tones. Every chip/badge in the Game Studio renders through
 * `UiStatus` — components never re-derive tone from raw domain strings
 * (E1 applied to presentation: one owner for the state→tone mapping).
 *
 * Pure module: no IO, no React.
 */

/** Presentation tones the studio components understand. */
export type UiTone = "ok" | "warn" | "error" | "neutral" | "info";

/** A mapped status: stable label + tone + (optional) explanatory note. */
export interface UiStatus {
  readonly label: string;
  readonly tone: UiTone;
  readonly note?: string;
}

/** Session phase → status chip (runtime-contracts phase vocabulary). */
export function phaseStatus(phase: string): UiStatus {
  switch (phase) {
    case "provisioning":
      return { label: "provisioning", tone: "info" };
    case "loading":
      return { label: "loading", tone: "info" };
    case "ready":
      return { label: "ready", tone: "ok" };
    case "running":
      return { label: "running", tone: "ok" };
    case "suspended":
      return { label: "suspended", tone: "warn" };
    case "terminating":
      return { label: "terminating", tone: "warn" };
    case "terminated":
      return { label: "terminated", tone: "neutral" };
    case "failed":
      return { label: "failed", tone: "error" };
    default:
      return { label: phase, tone: "neutral" };
  }
}

/** Tool-job status → status chip (tool-fabric-runtime job vocabulary). */
export function toolJobStatus(status: string): UiStatus {
  switch (status) {
    case "queued":
      return { label: "queued", tone: "info" };
    case "running":
      return { label: "running", tone: "info" };
    case "succeeded":
      return { label: "succeeded", tone: "ok" };
    case "failed":
      return { label: "failed", tone: "error" };
    case "timed-out":
      return { label: "timed out", tone: "error" };
    case "cancelled":
      return { label: "cancelled", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Adapter lifecycle state → status chip (engine-adapter-contract vocabulary:
 * registered → ready → degraded → closed). */
export function adapterStatus(state: string): UiStatus {
  switch (state) {
    case "registered":
      return { label: "registered", tone: "info" };
    case "ready":
      return { label: "ready", tone: "ok" };
    case "degraded":
      return { label: "degraded", tone: "warn" };
    case "closed":
      return { label: "closed", tone: "neutral" };
    default:
      return { label: state, tone: "neutral" };
  }
}

/** Release-gate verdict → status chip (package-system R19). */
export function releaseGateStatus(pass: boolean): UiStatus {
  return pass
    ? { label: "gate passed", tone: "ok" }
    : { label: "gate blocked", tone: "error" };
}

/** License state → status chip (package-system license vocabulary). */
export function licenseStatus(status: string): UiStatus {
  switch (status) {
    case "verified":
      return { label: "verified", tone: "ok" };
    case "declared":
      return { label: "declared", tone: "warn" };
    default:
      return { label: "unknown", tone: "error" };
  }
}

/** Grant presence → status chip (capability broker, R5/least-privilege). */
export function grantStatus(
  capability: string,
  grantHolders: readonly string[],
): UiStatus {
  if (grantHolders.length === 0) {
    return { label: "ungranted", tone: "error", note: `no active grant covers ${capability}` };
  }
  const holderList = [...grantHolders].sort().join(", ");
  return { label: "granted", tone: "ok", note: `holders: ${holderList}` };
}

/** Operation outcome → status chip for timeline rows. */
export function outcomeStatus(status: string): UiStatus {
  switch (status) {
    case "loaded":
    case "observed":
    case "committed":
    case "stepped":
    case "reset":
    case "restored":
    case "snapshotted":
    case "replayed":
    case "terminated":
    case "granted":
    case "created":
      return { label: status, tone: "ok" };
    case "duplicate":
      return { label: "duplicate receipt", tone: "info" };
    case "rejected":
      return { label: "rejected", tone: "error" };
    case "failed":
      return { label: "failed", tone: "error" };
    case "denied":
      return { label: "denied", tone: "error" };
    default:
      return { label: status, tone: "neutral" };
  }
}
