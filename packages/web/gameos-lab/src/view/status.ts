/**
 * SHARED UI STATUS VOCABULARY (pure): the ONE mapping from the Lab read
 * models' domain states to presentation tones. Every chip/badge in the
 * Lab workbench renders through `UiStatus` — components never re-derive
 * tone from raw domain strings (E1 applied to presentation; game-ui
 * precedent, status.ts).
 *
 * Epistemic discipline (E11, lock 28/29) lives HERE too: observed
 * evidence and labeled estimates map to DIFFERENT tones + labels, so the
 * two epistemic classes can never render visually conflated.
 *
 * Pure module: no IO, no React.
 */

/** Presentation tones the Lab workbench components understand. */
export type UiTone = "ok" | "warn" | "error" | "neutral" | "info";

/** A mapped status: stable label + tone + (optional) explanatory note. */
export interface UiStatus {
  readonly label: string;
  readonly tone: UiTone;
  readonly note?: string;
}

/**
 * Capability-gap ladder rung → status chip (lab-contracts frozen ladder:
 * existing organization → … → Arena → blocked; R18). Earlier rungs are
 * the autonomous path (ok), the human rungs are deliberate (warn), and
 * the terminal blocked rung is the only error.
 */
export function gapRungStatus(rung: string): UiStatus {
  switch (rung) {
    case "existing-organization":
      return { label: rung, tone: "info", note: "ladder rung 1 — autonomous first resort" };
    case "alternate-organization":
      return { label: rung, tone: "info", note: "ladder rung 2 — autonomous" };
    case "package-platform-capability":
      return { label: rung, tone: "info", note: "ladder rung 3 — autonomous" };
    case "user-community-contribution":
      return { label: rung, tone: "warn", note: "ladder rung 4 — optional human resort (lock 31)" };
    case "arena-escalation":
      return { label: rung, tone: "warn", note: "ladder rung 5 — external, last-but-one resort (lock 32)" };
    case "blocked":
      return { label: rung, tone: "error", note: "terminal: no further rung" };
    default:
      return { label: rung, tone: "neutral" };
  }
}

/** Arena escalation case lifecycle state → status chip (arena-integration). */
export function arenaLifecycleStatus(state: string): UiStatus {
  switch (state) {
    case "draft":
      return { label: "draft", tone: "info" };
    case "authorized":
      return { label: "authorized", tone: "info" };
    case "sent":
      return { label: "sent", tone: "info", note: "awaiting Arena response" };
    case "responded":
      return { label: "responded", tone: "warn", note: "response not yet ingested" };
    case "ingested":
      return { label: "ingested", tone: "ok", note: "evidence filed, read-only (E10)" };
    case "rejected":
      return { label: "rejected", tone: "error" };
    case "expired":
      return { label: "expired", tone: "neutral" };
    default:
      return { label: state, tone: "neutral" };
  }
}

/**
 * Estimate method → status chip (lab-contracts frozen vocabulary, E11):
 * EVERY estimate-method chip carries the `estimate` prefix in its label
 * and the SAME info tone — method is reviewability, never a claim of
 * observed fact.
 */
export function estimateMethodStatus(method: string): UiStatus {
  switch (method) {
    case "simulation":
      return { label: "estimate · simulation", tone: "info", note: "simulator output is not ground truth (lock 29)" };
    case "counterfactual-replay":
      return { label: "estimate · counterfactual-replay", tone: "info", note: "counterfactual, explicitly not what happened (lock 28)" };
    case "analytical-model":
      return { label: "estimate · analytical-model", tone: "info" };
    case "expert-judgment":
      return { label: "estimate · expert-judgment", tone: "info" };
    default:
      return { label: `estimate · ${method}`, tone: "warn", note: "unknown estimate method" };
  }
}

/**
 * Observed-evidence marker → status chip (E11 observed class). Distinct
 * label AND distinct tone family from {@link estimateMethodStatus} —
 * observed facts are green, estimates are teal.
 */
export function observedEvidenceStatus(): UiStatus {
  return { label: "observed evidence", tone: "ok", note: "recorded fact, immutable (E10)" };
}

/** Gap summary recurrence/resolution → status chip (R18). */
export function gapSummaryStatus(recurring: boolean, resolved: boolean, blocked: boolean): UiStatus {
  if (resolved) return { label: "resolved", tone: "ok" };
  if (blocked) return { label: "blocked", tone: "error", note: "terminal rung reached" };
  if (recurring) return { label: "recurring", tone: "warn", note: "reappeared across cycles — never silently skipped" };
  return { label: "open", tone: "info" };
}

/** Search stream progress → status chip. */
export function searchProgressStatus(done: boolean): UiStatus {
  return done
    ? { label: "stream complete", tone: "neutral" }
    : { label: "stream open", tone: "info" };
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

/** Search evidence row epistemic chip (always a labeled estimate, E11). */
export function evidenceEpistemicStatus(): UiStatus {
  return {
    label: "labeled estimate",
    tone: "info",
    note: "evaluation output — explicitly not an observation (E11)",
  };
}
