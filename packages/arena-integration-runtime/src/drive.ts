/**
 * ORCHESTRATION DRIVE STEPS (PL-031, E6) — pure folds the service applies.
 *
 * Each step advances one case through arena-integration's OWN frozen state
 * machine (lifecycle.ts there: draft→authorized→sent→responded→
 * ingested|rejected|expired) and returns a {@link DriveStep}: the advanced
 * case (plus any ledger/audit update the service must file), an honest
 * outcome (a legitimate end or intermediate state — statuses, not failures),
 * or a typed refusal (which mutates nothing). Every step is a pure fold over
 * its arguments; persistence order is the SERVICE's concern (each advance
 * persists before the next step begins — E6 crash resumability).
 *
 * Lifecycle discipline kept exactly as arena-integration's frozen table:
 * - `sent→rejected` does NOT exist — a structurally invalid transport
 *   payload is a PROTOCOL VIOLATION (the port's own fake refuses exactly
 *   that): the case stays durably `sent`, honest `transport-error`;
 * - a structurally valid but digest-TAMPERED response DID arrive: the case
 *   advances `sent→responded`, and the ingest step's tamper oracle ends it
 *   `responded→rejected` with the honest `tampered-response-digest` status —
 *   nothing from the response is ever ingested (E8);
 * - a response that fails arena-integration's validator ends the case
 *   `rejected` WITH the rejected-verdict evidence package filed (a refusal
 *   is evidence, E10).
 *
 * Purity: no IO beyond the injected transport port, no clock reads (time is
 * caller-supplied), no randomness.
 */

import {
  advanceArenaLifecycle,
  appendArenaAuthorizationDecision,
  arenaSendIdempotencyKey,
  arenaSendIdempotencyKeyText,
  isArenaResponseEnvelope,
  settleArenaIngest,
  settleArenaSend,
} from "@playliquid/arena-integration";
import type {
  ArenaAuthorizationAuditLog,
  ArenaAuthorizationPolicy,
  ArenaLifecycleState,
  ArenaSendReceipt,
  ArenaTimestampMs,
  ArenaTransport,
} from "@playliquid/arena-integration";
import { arenaAuditRecordDigestOf, arenaDigestOf, arenaResponseDigestMatches } from "./digest.ts";
import type { ArenaEscalationCase } from "./records.ts";
import type { DriveCaseOutcome, DriveCaseResult } from "./service-types.ts";

/**
 * One drive step's result. `advanced` carries the new case (plus the send
 * receipt / audit log the service must file); `outcome` carries an honest
 * status with the case to persist when the step advanced it (`commit`);
 * `refusal` carries a typed refusal — refusals mutate NOTHING.
 */
export type DriveStep =
  | {
      readonly kind: "advanced";
      readonly case: ArenaEscalationCase;
      readonly auditLog?: ArenaAuthorizationAuditLog;
      readonly sendReceipt?: ArenaSendReceipt;
    }
  | {
      readonly kind: "outcome";
      readonly outcome: DriveCaseOutcome;
      readonly commit?: ArenaEscalationCase;
      readonly auditLog?: ArenaAuthorizationAuditLog;
    }
  | { readonly kind: "refusal"; readonly refusal: DriveCaseResult };

/** True for the terminal lifecycle states (immutable history, E10). */
export function isTerminalArenaState(state: ArenaLifecycleState): boolean {
  return state === "ingested" || state === "rejected" || state === "expired";
}

/** draft → authorized | rejected (Lab usage-rule policy + audit append). */
export function authorizeCaseStep(
  record: ArenaEscalationCase,
  policy: ArenaAuthorizationPolicy,
  auditLog: ArenaAuthorizationAuditLog,
  now: ArenaTimestampMs,
): DriveStep {
  const decision = policy.decide(record.request);
  const content = {
    decision: decision.allowed ? ("allow" as const) : ("deny" as const),
    ...(decision.allowed ? {} : { reason: decision.reason }),
    policyId: policy.policyId,
    requestPayload: record.request.cycle.requestPayload,
    endpoint: record.request.endpoint,
    decidedAt: now,
  };
  const appended = appendArenaAuthorizationDecision(auditLog, {
    ...content,
    recordDigest: arenaDigestOf(arenaAuditRecordDigestOf(content))!,
  });
  if (!appended.ok) {
    return {
      kind: "refusal",
      refusal: { ok: false, code: "audit-conflict", detail: `the authorization audit append was refused: ${appended.reason}` },
    };
  }
  const target: ArenaLifecycleState = decision.allowed ? "authorized" : "rejected";
  const advanced = advanceArenaLifecycle(record.lifecycle, target, now);
  if (!advanced.ok) {
    return refusedTransition(`draft→${target}`);
  }
  const updated: ArenaEscalationCase = Object.freeze({ ...record, lifecycle: advanced.record });
  return decision.allowed
    ? { kind: "advanced", case: updated, auditLog: appended.log }
    : {
        kind: "outcome",
        outcome: { status: "policy-denied", case: updated, reason: decision.reason },
        commit: updated,
        auditLog: appended.log,
      };
}

/** authorized → sent (the send idempotency oracle over the receipt ledger). */
export function settleSendCaseStep(
  record: ArenaEscalationCase,
  priorReceipt: ArenaSendReceipt | undefined,
  now: ArenaTimestampMs,
): DriveStep {
  const key = arenaSendIdempotencyKey(record.request);
  const settle = settleArenaSend(priorReceipt, record.request);
  if (settle.status === "not-sendable") {
    return { kind: "refusal", refusal: { ok: false, code: "invalid-envelope", detail: "the request envelope is not sendable (structural)" } };
  }
  if (settle.status === "duplicate-send") {
    return {
      kind: "refusal",
      refusal: {
        ok: false,
        code: "duplicate-send",
        detail: `the send key ${arenaSendIdempotencyKeyText(key)} is already owned by the first effective send; re-drive the owning case instead of opening a second one (E6)`,
      },
    };
  }
  if (settle.status === "send-collision") {
    return {
      kind: "refusal",
      refusal: {
        ok: false,
        code: "send-collision",
        detail: `one request payload to one endpoint is sent at most once effectively; the key ${arenaSendIdempotencyKeyText(key)} was already sent under a different envelope (E8)`,
      },
    };
  }
  const advanced = advanceArenaLifecycle(record.lifecycle, "sent", now);
  if (!advanced.ok) {
    return refusedTransition("authorized→sent");
  }
  const updated: ArenaEscalationCase = Object.freeze({ ...record, lifecycle: advanced.record, sendReceipt: settle.receipt });
  return { kind: "advanced", case: updated, sendReceipt: settle.receipt };
}

/**
 * sent → responded (the transport port). A transport error leaves the case
 * durably `sent` (a re-drive retries the SAME envelope; the Arena side
 * dedupes by content key, E6). A payload that is not a response envelope is
 * a protocol violation of the port contract — same durable standing.
 */
export async function deliverCaseStep(
  record: ArenaEscalationCase,
  transport: ArenaTransport,
  now: ArenaTimestampMs,
): Promise<DriveStep> {
  const result = await transport.send(record.request);
  if (!result.ok) {
    return { kind: "outcome", outcome: { status: "transport-error", case: record, errorKind: result.error.errorKind } };
  }
  const response = result.response;
  if (!isArenaResponseEnvelope(response)) {
    return {
      kind: "outcome",
      outcome: { status: "transport-error", case: record, errorKind: "arena-protocol-violation" },
    };
  }
  const advanced = advanceArenaLifecycle(record.lifecycle, "responded", now);
  if (!advanced.ok) {
    return refusedTransition("sent→responded");
  }
  const updated: ArenaEscalationCase = Object.freeze({ ...record, lifecycle: advanced.record, response });
  return { kind: "advanced", case: updated };
}

/**
 * responded → ingested | rejected (the ingest oracle). The runtime's response
 * TAMPER ORACLE runs BEFORE arena-integration's validator: the declared
 * responseDigest must pin the response's content, or the case ends rejected
 * with NOTHING ingested (E8). Validation failures end the case rejected with
 * the rejected-verdict evidence package filed (a refusal is evidence, E10).
 */
export function ingestCaseStep(record: ArenaEscalationCase, now: ArenaTimestampMs): DriveStep {
  const response = record.response;
  if (response === undefined) {
    return {
      kind: "refusal",
      refusal: { ok: false, code: "inconsistent-state", detail: "a responded case carries no durable response envelope" },
    };
  }
  if (!arenaResponseDigestMatches(response)) {
    const rejected = rejectCase(record, now);
    if (rejected === undefined) return refusedTransition("responded→rejected");
    return { kind: "outcome", outcome: { status: "tampered-response-digest", case: rejected }, commit: rejected };
  }
  const settle = settleArenaIngest(record.ingestReceipt, response, record.request, now);
  if (settle.status === "not-ingestible") {
    const rejected = rejectCase(record, now);
    if (rejected === undefined) return refusedTransition("responded→rejected");
    return {
      kind: "outcome",
      outcome: { status: "response-rejected", case: rejected, reasons: Object.freeze(["malformed-response"]) },
      commit: rejected,
    };
  }
  if (settle.status === "ingest-collision") {
    return {
      kind: "refusal",
      refusal: {
        ok: false,
        code: "ingest-collision",
        detail: "one response is ingested at most once effectively; the prior receipt stands (E8)",
      },
    };
  }
  const evidencePackage = settle.receipt.evidencePackage;
  const advanced = advanceArenaLifecycle(record.lifecycle, evidencePackage.verdict === "admitted" ? "ingested" : "rejected", now);
  if (!advanced.ok) {
    return refusedTransition("responded→terminal");
  }
  const updated: ArenaEscalationCase = Object.freeze({
    ...record,
    lifecycle: advanced.record,
    ...(settle.status === "duplicate-ingest" ? {} : { ingestReceipt: settle.receipt }),
    evidencePackage,
  });
  return evidencePackage.verdict === "admitted"
    ? { kind: "outcome", outcome: { status: "ingested", case: updated, evidencePackage }, commit: updated }
    : { kind: "outcome", outcome: { status: "response-rejected", case: updated, reasons: evidencePackage.reasons }, commit: updated };
}

/** Ends the case `rejected` (responded→rejected), or undefined if refused. */
function rejectCase(record: ArenaEscalationCase, now: ArenaTimestampMs): ArenaEscalationCase | undefined {
  const advanced = advanceArenaLifecycle(record.lifecycle, "rejected", now);
  return advanced.ok ? Object.freeze({ ...record, lifecycle: advanced.record }) : undefined;
}

/** The typed refusal for an illegal-transition surprise (E1 authority). */
function refusedTransition(what: string): DriveStep {
  return {
    kind: "refusal",
    refusal: { ok: false, code: "inconsistent-state", detail: `${what} was refused by the lifecycle authority` },
  };
}
