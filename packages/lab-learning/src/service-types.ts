/**
 * LAB LEARNING SERVICE DOOR TYPES (PL-030) — the typed inputs and results
 * of every `LabLearningService` door (the platform-economy /
 * lab-organization service-types.ts precedent; split from service.ts to
 * keep both modules inside the house file-size budget).
 *
 * Every door is TOTAL: the failure arms carry typed kebab-case codes.
 * The learn door's duplicate arm is the E10 idempotent receipt (the
 * existing record, `duplicate: true`) — never a second copy, never an
 * error. Pure types only.
 */

import type { LearningCycleRecord, LearningReadRefusalCode } from "./records.ts";
import type { LearnAdmissionCode, LabCycleLearningSubmission } from "./records.ts";
import type { LabLearningSignals } from "./signals.ts";
import type { GapLadderSummary } from "./gaps.ts";
import type { GuidanceDerivationMode, GuidanceRefusalCode, LabSearchGuidance } from "./guidance.ts";

/** Result of the learn door (E10 receipt on duplicates). */
export type LearnDoorResult =
  | { readonly ok: true; readonly record: LearningCycleRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: LearnAdmissionCode; readonly detail: string };

/** Result of tenant-scoped record reads. */
export type LearningReadResult =
  | { readonly ok: true; readonly record: LearningCycleRecord }
  | { readonly ok: false; readonly code: LearningReadRefusalCode; readonly detail: string };

/** Result of the signals door. */
export type SignalsDoorResult =
  | { readonly ok: true; readonly signals: LabLearningSignals }
  | { readonly ok: false; readonly code: "cross-tenant"; readonly detail: string };

/** Result of the guidance door (the top-level product). */
export type GuidanceDoorResult =
  | { readonly ok: true; readonly guidance: LabSearchGuidance }
  | { readonly ok: false; readonly code: GuidanceRefusalCode | "cross-tenant"; readonly detail: string };

/** Result of the guidance verification door (E11 tamper surface). */
export type VerifyGuidanceDoorResult =
  | { readonly ok: true; readonly matches: boolean }
  | { readonly ok: false; readonly code: GuidanceRefusalCode | "cross-tenant"; readonly detail: string };

/** Result of the document restore door (E6/E8 tamper surface). */
export type RestoreDoorResult =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly code: "no-persisted-document" | "tampered-content-digest"; readonly detail: string };

/** Input of the guidance doors. */
export interface GuidanceDoorInput {
  /** The derivation mode (the marker always tells the truth about use). */
  readonly mode: GuidanceDerivationMode;
}

/** Input of the guidance verification door. */
export interface VerifyGuidanceDoorInput extends GuidanceDoorInput {
  /** The guidance object to verify against the re-derived state. */
  readonly guidance: unknown;
}

/** The submission the learn door admits (re-exported for door signatures). */
export type LearnDoorInput = LabCycleLearningSubmission;

/** The R18 gap-summary door result (typed, with recurrence counts). */
export type GapSummariesDoorResult = readonly GapLadderSummary[];
