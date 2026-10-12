/**
 * EPISTEMIC LABELING OF INGESTED ARENA CONTENT (E11; architecture.md
 * §Arena "validated results; evidence; artifacts where explicitly
 * authorized"; lock rules 6/32).
 *
 * Everything the Arena returns is EXTERNAL, UNTRUSTED-UNTIL-VALIDATED input:
 * "validated" means it passed arena-integration's admission validator
 * (structural shape, digest pins, authorization scopes, evidence linkage) —
 * it NEVER means ground truth, and never grants authority over PlayLiquid
 * state. The labeling below makes that standing machine-checkable:
 *
 * - every labeled record carries the `epistemic: "arena-external"` marker —
 *   STRUCTURALLY DISJOINT from lab-contracts' internal epistemic markers
 *   (`"observed-evidence"` for historical observations, `"labeled-estimate"`
 *   for Lab-produced estimates): an Arena record can never silently present
 *   as either (negative-tested);
 * - every labeled record carries its {@link ArenaProvenance} (respondent
 *   endpoint, response digest, request payload digest, request kind) and
 *   the authorization scope that gated it — provenance and authorization
 *   travel with EVERY artifact (work-order E11 requirement);
 * - the frozen external-class vocabulary discriminates the three declared
 *   return classes plus the estimate class:
 *   `external-validated-result` (a result payload from an admitted
 *   response), `external-evidence` (an evidence payload), `
 *   external-authorized-artifact` (an artifact payload within its
 *   explicitly authorized class), `external-estimate` (a result the host
 *   asserts is an external judgment — the ONLY way to obtain this class is
 *   {@link asArenaEstimate}, which requires a lab-contracts estimate
 *   method; the estimate label can never be stripped back into a validated
 *   result silently).
 *
 * Purity: no IO, no clock, no randomness; a pure fold over passive data.
 */

import { arenaAuthorizationScopeKey, scopeAllowsArtifact } from "@playliquid/arena-integration";
import type {
  ArenaAuthorizationScope,
  ArenaEndpointRef,
  ArenaEvidencePackage,
  ArenaRequestEnvelope,
  ArenaContentDigest,
  ArenaRequestKind,
} from "@playliquid/arena-integration";
import type { EstimateMethod } from "@playliquid/lab-contracts";
import { isEstimateMethod } from "@playliquid/lab-contracts";

/** The frozen epistemic class vocabulary of ingested Arena content. */
export type ArenaExternalClass =
  | "external-validated-result"
  | "external-evidence"
  | "external-authorized-artifact"
  | "external-estimate";

/** All valid {@link ArenaExternalClass} values (frozen). */
export const ARENA_EXTERNAL_CLASSES: readonly ArenaExternalClass[] = Object.freeze([
  "external-validated-result",
  "external-evidence",
  "external-authorized-artifact",
  "external-estimate",
]);

/** Returns true when `value` is a valid {@link ArenaExternalClass}. */
export function isArenaExternalClass(value: unknown): value is ArenaExternalClass {
  return typeof value === "string" && (ARENA_EXTERNAL_CLASSES as readonly string[]).includes(value);
}

/** The provenance that travels with every labeled Arena record (E11). */
export interface ArenaProvenance {
  readonly origin: "arena-external";
  readonly respondent: ArenaEndpointRef;
  readonly responseDigest: ArenaContentDigest;
  readonly requestPayload: ArenaContentDigest;
  readonly requestKind: ArenaRequestKind;
  /** The authorization scope that gated the response (scope key for logs). */
  readonly authorizationKey: string;
}

/** One labeled Arena payload — passive, immutable data (never authority). */
export interface ArenaLabeledPayload {
  readonly epistemic: "arena-external";
  readonly externalClass: ArenaExternalClass;
  readonly content: ArenaContentDigest;
  readonly provenance: ArenaProvenance;
  /** The estimate method — present on (and only on) external-estimate records. */
  readonly estimateMethod?: EstimateMethod;
}

/** Returns true when `value` is structurally a valid {@link ArenaLabeledPayload}. */
export function isArenaLabeledPayload(value: unknown): value is ArenaLabeledPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.epistemic !== "arena-external") return false;
  if (!isArenaExternalClass(record.externalClass)) return false;
  if (typeof record.content !== "string" || record.content.length === 0) return false;
  if (typeof record.provenance !== "object" || record.provenance === null) return false;
  if (record.estimateMethod !== undefined && !isEstimateMethod(record.estimateMethod)) return false;
  const provenance = record.provenance as Record<string, unknown>;
  return (
    provenance.origin === "arena-external" &&
    typeof provenance.respondent === "object" &&
    provenance.respondent !== null &&
    typeof provenance.responseDigest === "string" &&
    typeof provenance.requestPayload === "string" &&
    typeof provenance.authorizationKey === "string"
  );
}

/**
 * The pure E11 fold: labels every payload of an ADMITTED evidence package
 * with its epistemic class and full provenance. Rejected-verdict packages
 * carry no payloads (a refusal is evidence, not content) and label to the
 * empty list. Artifacts are labeled with the authorization scope that gated
 * them; an artifact whose class is not covered by the request scope cannot
 * appear in an admitted package (arena-integration's validator) and is
 * refused here as well (defense in depth — the fold is total).
 */
export function labelArenaEvidencePackage(
  evidencePackage: ArenaEvidencePackage,
  request: ArenaRequestEnvelope,
): readonly ArenaLabeledPayload[] {
  if (evidencePackage.verdict !== "admitted") return [];
  const provenance: ArenaProvenance = Object.freeze({
    origin: "arena-external",
    respondent: evidencePackage.respondent,
    responseDigest: evidencePackage.responseDigest,
    requestPayload: evidencePackage.requestPayload,
    requestKind: request.requestKind,
    authorizationKey: arenaAuthorizationScopeKey(request.cycle.authorization),
  });
  const labeled: ArenaLabeledPayload[] = [];
  for (const result of evidencePackage.results) {
    labeled.push(
      Object.freeze({
        epistemic: "arena-external" as const,
        externalClass: "external-validated-result" as const,
        content: result.content,
        provenance,
      }),
    );
  }
  for (const evidence of evidencePackage.evidence) {
    for (const digest of evidence.evidence) {
      labeled.push(
        Object.freeze({
          epistemic: "arena-external" as const,
          externalClass: "external-evidence" as const,
          content: digest,
          provenance,
        }),
      );
    }
  }
  for (const artifact of evidencePackage.artifacts) {
    if (!scopeAllowsArtifact(request.cycle.authorization, artifact.artifactClass)) continue;
    labeled.push(
      Object.freeze({
        epistemic: "arena-external" as const,
        externalClass: "external-authorized-artifact" as const,
        content: artifact.artifact,
        provenance,
      }),
    );
  }
  return Object.freeze(labeled);
}

/**
 * The ONLY way to obtain an `external-estimate` label: the host asserts that
 * a validated external RESULT is an external judgment (an estimate), with a
 * declared lab-contracts estimate method (typically "expert-judgment").
 * The re-label is one-way — there is no function that strips an estimate
 * label back into a validated result; the two classes stay disjoint.
 * Refuses (returns `undefined`) anything that is not a validated external
 * result or an invalid method.
 */
export function asArenaEstimate(labeled: ArenaLabeledPayload, method: EstimateMethod): ArenaLabeledPayload | undefined {
  if (labeled.epistemic !== "arena-external" || labeled.externalClass !== "external-validated-result") return undefined;
  if (!isEstimateMethod(method)) return undefined;
  return Object.freeze({
    ...labeled,
    externalClass: "external-estimate",
    estimateMethod: method,
  });
}

/** True iff `labeled` is an estimate-labeled Arena record. */
export function isArenaEstimate(labeled: ArenaLabeledPayload): boolean {
  return labeled.externalClass === "external-estimate" && isEstimateMethod(labeled.estimateMethod);
}

/** The authorization scope a labeled record was gated by (re-exported key helper consumers use). */
export { arenaAuthorizationScopeKey };
export type { ArenaAuthorizationScope };
