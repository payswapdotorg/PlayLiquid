/**
 * SERVICE DOOR VIEW HELPERS (PL-029) — the ok/refusal constructors of the
 * `LabOrganizationService` doors, split from service.ts (the state owner) to
 * keep both modules inside the house file-size budget (400 raw lines;
 * platform-economy/service-types.ts precedent).
 *
 * Three pure constructors, nothing else:
 * - {@link openedView} — the session receipt of a search open/resume;
 * - {@link pageRefuse} — a candidate-stream page refusal;
 * - {@link evalRefuse} — a candidate-evaluation refusal (optionally
 *   carrying the accumulated compiler rejections and the surfaced
 *   lab-simulation port code).
 *
 * Pure module: no IO, no clocks, no state.
 */

import type { StoredSearch } from "./ports.ts";
import type { EvaluateDoorResult, SearchOpenResult, SearchPageResult } from "./service-types.ts";
import type { CompileRejection, EvaluateRefusalCode, SearchPageRefusalCode } from "./records.ts";
import { cursorOf } from "./sessions.ts";

/** Builds the opened-search view of a stored session. */
export function openedView(stored: StoredSearch, duplicate: boolean): SearchOpenResult {
  return {
    ok: true,
    duplicate,
    searchId: stored.searchId,
    size: stored.space.size,
    spaceDigest: stored.space.digest,
    position: stored.position,
    cursor: cursorOf(stored),
  };
}

/** Page refusal helper. */
export function pageRefuse(code: SearchPageRefusalCode, detail: string): SearchPageResult {
  return { ok: false, code, detail };
}

/** Evaluation refusal helper (rejections/portCode carried when present). */
export function evalRefuse(
  code: EvaluateRefusalCode,
  detail: string,
  rejections?: readonly CompileRejection[],
  portCode?: string,
): EvaluateDoorResult {
  return { ok: false, code, detail, rejections, portCode };
}
