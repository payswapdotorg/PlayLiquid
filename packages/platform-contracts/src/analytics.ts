/**
 * ANALYTICS PLATFORM SERVICE CONTRACTS (R7 / lock rule 17).
 *
 * Analytics is a platform capability with an explicit privacy contract.
 * Games declare their analytics events together with a per-event privacy
 * class ({@link AnalyticsEventBinding}, lock 18); the platform owns
 * ingestion validation, retention and redaction. Privacy class is
 * explicit per event, never implicit (architecture "Analytics policy").
 *
 * Credential-shaped payload keys are NEVER admissible in analytics
 * payloads ({@link ANALYTICS_FORBIDDEN_PAYLOAD_KEYS}, E8/E3 hygiene);
 * the ingest oracle rejects them with a typed code.
 *
 * Purity: pure types + pure guards + a pure batch ingest oracle. No IO.
 */

import type { SubjectId, TenantId } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";

/** Privacy classes an analytics event may carry (mirrors game-contracts). */
export type AnalyticsPrivacyClass = "anonymous" | "pseudonymous" | "identified";

/** All valid {@link AnalyticsPrivacyClass} values. */
export const ANALYTICS_PRIVACY_CLASSES: readonly AnalyticsPrivacyClass[] = Object.freeze([
  "anonymous",
  "pseudonymous",
  "identified",
]);

/** Payload keys that are never admissible in analytics payloads. */
export const ANALYTICS_FORBIDDEN_PAYLOAD_KEYS: readonly string[] = Object.freeze([
  "credentials",
  "credential",
  "secrets",
  "secret",
  "tokens",
  "token",
  "password",
  "passwords",
  "apikey",
  "privateKey",
]);

/** Returns true when `key` is a forbidden analytics payload key. */
export function isForbiddenAnalyticsPayloadKey(key: string): boolean {
  return (ANALYTICS_FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Service policy + game-side event binding
// ---------------------------------------------------------------------------

/** Platform analytics service behavior descriptor. */
export interface AnalyticsServicePolicy {
  readonly maxEventsPerBatch: number;
  readonly defaultRetentionDays: number;
}

/** Returns true when `value` is a structurally valid {@link AnalyticsServicePolicy}. */
export function isAnalyticsServicePolicy(value: unknown): value is AnalyticsServicePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.maxEventsPerBatch === "number" &&
    Number.isInteger(policy.maxEventsPerBatch) &&
    policy.maxEventsPerBatch >= 1 &&
    policy.maxEventsPerBatch <= 1000 &&
    typeof policy.defaultRetentionDays === "number" &&
    Number.isInteger(policy.defaultRetentionDays) &&
    policy.defaultRetentionDays >= 1
  );
}

/**
 * How a game declares one of ITS events as an analytics event, with the
 * event's privacy class and retention (lock 18: declaration, not
 * collection logic).
 */
export interface AnalyticsEventBinding {
  readonly capability: "analytics";
  readonly eventKind: GameEventKind;
  readonly privacy: AnalyticsPrivacyClass;
  readonly retentionDays: number;
}

/** Returns true when `value` is a structurally valid {@link AnalyticsEventBinding}. */
export function isAnalyticsEventBinding(value: unknown): value is AnalyticsEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    binding.capability === "analytics" &&
    typeof binding.eventKind === "string" &&
    binding.eventKind.length > 0 &&
    typeof binding.privacy === "string" &&
    (ANALYTICS_PRIVACY_CLASSES as readonly string[]).includes(binding.privacy) &&
    typeof binding.retentionDays === "number" &&
    Number.isInteger(binding.retentionDays) &&
    binding.retentionDays >= 1
  );
}

// ---------------------------------------------------------------------------
// Ingestion (request/response with typed per-record negative paths)
// ---------------------------------------------------------------------------

/** One recorded analytics event as submitted for ingestion. */
export interface AnalyticsEventRecord {
  readonly eventKind: GameEventKind;
  readonly privacy: AnalyticsPrivacyClass;
  readonly subject?: SubjectId;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A batch ingestion request, always tenant-scoped (R20). */
export interface AnalyticsSubmissionRequest {
  readonly tenant: TenantId;
  readonly events: readonly AnalyticsEventRecord[];
}

/** Typed refusal for one record of a batch. */
export interface AnalyticsRejection {
  readonly index: number;
  readonly code: "undeclared-event-kind" | "privacy-mismatch" | "subject-on-anonymous" | "forbidden-payload-key";
}

/** The platform's response to a submission. */
export interface AnalyticsIngestReceipt {
  readonly acceptedCount: number;
  readonly rejected: readonly AnalyticsRejection[];
}

/**
 * Pure batch ingest oracle. Rules per record (E8 negative coverage):
 * the event kind must be one of the game's declared analytics events
 * (`undeclared-event-kind`), the record's privacy class must match the
 * declaration (`privacy-mismatch`), anonymous events must not carry a
 * subject (`subject-on-anonymous`), and payloads must not contain
 * forbidden keys (`forbidden-payload-key`). Batches larger than the
 * policy maximum are refused wholesale (empty receipt, zero accepted —
 * no partial sneaking past the cap).
 */
export function ingestAnalyticsBatch(
  request: { readonly events: readonly AnalyticsEventRecord[] },
  declared: readonly AnalyticsEventBinding[],
  policy: AnalyticsServicePolicy,
): AnalyticsIngestReceipt {
  if (request.events.length > policy.maxEventsPerBatch) {
    return { acceptedCount: 0, rejected: [] };
  }
  let acceptedCount = 0;
  const rejected: AnalyticsRejection[] = [];
  request.events.forEach((record, index) => {
    const declaration = declared.find((binding) => binding.eventKind === record.eventKind);
    if (declaration === undefined) {
      rejected.push({ index, code: "undeclared-event-kind" });
      return;
    }
    if (declaration.privacy !== record.privacy) {
      rejected.push({ index, code: "privacy-mismatch" });
      return;
    }
    if (record.privacy === "anonymous" && record.subject !== undefined) {
      rejected.push({ index, code: "subject-on-anonymous" });
      return;
    }
    const forbidden = Object.keys(record.payload).find((key) => isForbiddenAnalyticsPayloadKey(key));
    if (forbidden !== undefined) {
      rejected.push({ index, code: "forbidden-payload-key" });
      return;
    }
    acceptedCount += 1;
  });
  return { acceptedCount, rejected };
}
