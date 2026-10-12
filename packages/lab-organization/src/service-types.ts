/**
 * LAB ORGANIZATION SERVICE DOOR TYPES (PL-029) — the typed inputs and
 * results of every `LabOrganizationService` door (the platform-economy
 * service-types.ts precedent; split from service.ts to keep both modules
 * inside the house file-size budget).
 *
 * Every door is TOTAL: the failure arms carry typed kebab-case codes (and,
 * where applicable, the accumulated compiler rejections or the surfaced
 * lab-simulation port code). Pure types only.
 */

import type {
  CapabilityGapRecord,
  CapabilityId,
  ContentDigest,
  EvaluationSeed,
  GapRungAttempt,
  LabCycleId,
  LabEvaluationSuiteRef,
  OrganizationSearchContext,
} from "@playliquid/lab-contracts";
import type { EvidenceBundleRef } from "@playliquid/lab-simulation";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { LabOrganizationCaller, StoredCandidateEvidence } from "./ports.ts";
import type {
  CompileRejection,
  CompileRefusalCode,
  CompiledOrganization,
  EvaluateRefusalCode,
  SearchCursor,
  SearchOpenRefusalCode,
  SearchPageRefusalCode,
  SearchedCandidate,
} from "./records.ts";

/** Result of the compile door. */
export type CompileDoorResult =
  | { readonly ok: true; readonly compiled: CompiledOrganization; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: CompileRefusalCode; readonly rejections: readonly CompileRejection[] };

/** Result of search opening (duplicate open = session receipt, E10-style). */
export type SearchOpenResult =
  | {
      readonly ok: true;
      readonly duplicate: boolean;
      readonly searchId: string;
      readonly size: number;
      readonly spaceDigest: ContentDigest;
      readonly position: number;
      readonly cursor: SearchCursor;
    }
  | { readonly ok: false; readonly code: SearchOpenRefusalCode; readonly detail: string };

/** Result of one candidate-stream page. */
export type SearchPageResult =
  | {
      readonly ok: true;
      readonly candidates: readonly SearchedCandidate[];
      readonly nextCursor?: SearchCursor;
      readonly done: boolean;
    }
  | { readonly ok: false; readonly code: SearchPageRefusalCode; readonly detail: string };

/** Result of candidate evaluation (E10 replay receipt on re-evaluation). */
export type EvaluateDoorResult =
  | {
      readonly ok: true;
      readonly replayed: boolean;
      readonly evidence: StoredCandidateEvidence;
      readonly gapFindings: readonly CapabilityGapRecord[];
    }
  | {
      readonly ok: false;
      readonly code: EvaluateRefusalCode;
      readonly detail: string;
      readonly rejections?: readonly CompileRejection[];
      readonly portCode?: string;
    };

/** Result of the gap-advance door. */
export type GapAdvanceDoorResult =
  | { readonly ok: true; readonly gap: CapabilityGapRecord }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/** Result of tenant-scoped compilation reads. */
export type CompilationReadResult =
  | { readonly ok: true; readonly compiled: CompiledOrganization }
  | { readonly ok: false; readonly code: "compilation-unknown" | "cross-tenant"; readonly detail: string };

/** Result of tenant-scoped gap reads. */
export type GapReadResult =
  | { readonly ok: true; readonly gap: CapabilityGapRecord }
  | { readonly ok: false; readonly code: "gap-unknown" | "cross-tenant"; readonly detail: string };

/** Input of the search-candidate evaluation door. */
export interface EvaluateCandidateDoorInput {
  readonly searchId: string;
  readonly position: number;
  readonly suite: LabEvaluationSuiteRef;
  readonly evidence: EvidenceBundleRef;
  readonly parameters: { readonly seed: EvaluationSeed; readonly tickBudget: number };
  readonly as: LabOrganizationCaller;
}

/** Input of the direct-organization evaluation door. */
export interface EvaluateOrganizationDoorInput {
  readonly descriptor: unknown;
  readonly cycleId: LabCycleId;
  readonly context: OrganizationSearchContext;
  readonly suite: LabEvaluationSuiteRef;
  readonly evidence: EvidenceBundleRef;
  readonly parameters: { readonly seed: EvaluationSeed; readonly tickBudget: number };
  readonly as: LabOrganizationCaller;
  readonly capabilities?: readonly CapabilityId[];
  readonly restriction?: HostRestriction;
}

/** Input of the gap-advance door. */
export interface GapAdvanceDoorInput {
  readonly gapId: string;
  readonly attempt: GapRungAttempt;
  readonly as: LabOrganizationCaller;
}
