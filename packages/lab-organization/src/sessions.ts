/**
 * SEARCH-SESSION ORACLES (PL-029) — the pure admission/paging logic of the
 * organization-search stream, split from service.ts (the state owner) to
 * keep both modules inside the house file-size budget.
 *
 * Two total oracles, consumed by `LabOrganizationService`:
 *
 * - {@link openSearchSession} — validates the whole request (tenant, owner,
 *   cycle, time, seed, context, current organization, host restriction),
 *   canonicalizes the dimension catalogs (space.ts), computes the finite
 *   candidate space and derives the content-addressed session identity
 *   (digest.ts). The returned {@link StoredSearch} is complete and frozen
 *   apart from the mutable stream `position` the service advances;
 * - {@link pageSearchSession} — the single-use monotonic cursor walk: a
 *   cursor is structurally valid, belongs to this search's space, matches
 *   the session position exactly (regressed/skipped-ahead cursors are
 *   typed refusals, E8) and is not past the end; the page size is bounded.
 *
 * Both are pure: no IO, no clocks (time is caller-supplied), no state —
 * the service owns persistence and tenancy checks (R20).
 */

import type { HostRestriction } from "@playliquid/game-contracts";
import { isGameIdentity, isHostRestriction } from "@playliquid/game-contracts";
import type { OrganizationSearchRequest, SearchCursor, SearchPageRefusalCode, SearchOpenRefusalCode, SearchedCandidate } from "./records.ts";
import { isSearchCursor, MAX_PAGE_SIZE } from "./records.ts";
import {
  TASK_DIFFICULTY_LEVELS,
  asEvaluationSeed,
  asLabCycleId,
  asTimestampMs,
  isOrganizationDescriptor,
  validateOrganization,
} from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { StoredSearch } from "./ports.ts";
import type { BodyCatalogPort } from "./compile.ts";
import { canonicalizeBounds, computeSpace, pageSizeOf } from "./space.ts";
import { candidateAtPosition, traversalOf } from "./search.ts";
import { searchIdentityDigest, searchSlugId } from "./digest.ts";

/** Result of {@link openSearchSession}. */
export type SessionOpenResult =
  | { readonly ok: true; readonly stored: StoredSearch }
  | { readonly ok: false; readonly code: SearchOpenRefusalCode; readonly detail: string };

/** Result of {@link pageSearchSession}. */
export type SessionPageResult =
  | { readonly ok: true; readonly candidates: readonly SearchedCandidate[]; readonly nextPosition: number; readonly done: boolean }
  | { readonly ok: false; readonly code: SearchPageRefusalCode; readonly detail: string };

/** Search-context structural validation (lock 25 vocabulary). */
export function validContext(context: OrganizationSearchRequest["context"]): boolean {
  return (
    isGameIdentity(context.game) &&
    typeof context.phase === "string" &&
    context.phase.length > 0 &&
    (TASK_DIFFICULTY_LEVELS as readonly string[]).includes(context.taskDifficulty) &&
    (context.deadline === undefined || asTimestampMs(context.deadline) !== undefined)
  );
}

/** Builds the next cursor of a search session. */
export function cursorOf(stored: StoredSearch): SearchCursor {
  return {
    kind: "search-cursor",
    searchId: stored.searchId,
    spaceDigest: stored.space.digest,
    nextIndex: stored.position,
  };
}

/**
 * The pure open oracle: everything from the raw request to the complete,
 * content-addressed session record (or a typed refusal). `now` stamps the
 * session's open time (caller-supplied; no clock authority here).
 */
export function openSearchSession(request: OrganizationSearchRequest, bodies: BodyCatalogPort, now: number): SessionOpenResult {
  if (asTenantId(request.tenant) === undefined) return fail("invalid-tenant", "tenant id failed validation");
  if (asSubjectId(request.owner) === undefined) return fail("invalid-owner", "owner subject id failed validation");
  if (asLabCycleId(request.cycleId) === undefined) return fail("invalid-cycle", "cycle id failed validation");
  if (asTimestampMs(request.requestedAt) === undefined) {
    return fail("invalid-request-time", "requestedAt must be a safe integer millisecond value");
  }
  if (asEvaluationSeed(request.seed) === undefined) {
    return fail("invalid-seed", "seed must be non-empty opaque text (E9)");
  }
  if (!validContext(request.context)) {
    return fail("invalid-context", "search context failed validation (game identity, phase, task difficulty or deadline)");
  }
  if (request.currentOrganization !== undefined) {
    const current = request.currentOrganization;
    if (!isOrganizationDescriptor(current) || !validateOrganization(current).ok) {
      return fail("invalid-current-organization", "the current organization failed lab-contracts validation");
    }
  }
  const restriction: HostRestriction | undefined = isHostRestriction(request.restriction) ? request.restriction : undefined;
  if (request.restriction !== undefined && restriction === undefined) {
    return fail("invalid-restriction", "restriction is not a valid HostRestriction");
  }
  const bounds = canonicalizeBounds(request.bounds, bodies);
  if (!bounds.ok) return fail(bounds.code, bounds.detail);
  const space = computeSpace(bounds.bounds);
  if (!space.ok) return fail(space.code, space.detail);
  const identity = searchIdentityDigest({
    tenant: String(request.tenant),
    cycleId: String(request.cycleId),
    context: request.context,
    seed: String(request.seed),
    bounds: space.space.bounds,
    currentOrganization: request.currentOrganization,
    restriction,
  });
  return {
    ok: true,
    stored: {
      searchId: searchSlugId(identity),
      tenant: request.tenant,
      owner: request.owner,
      request: {
        cycleId: request.cycleId,
        context: request.context,
        seed: request.seed,
        currentOrganization: request.currentOrganization,
        restriction,
      },
      space: space.space,
      position: 0,
      openedAt: asTimestampMs(now)!,
    },
  };
}

/** The pure page oracle: cursor validation + one bounded page of candidates. */
export function pageSearchSession(
  stored: StoredSearch,
  input: { readonly cursor: unknown; readonly limit?: number },
): SessionPageResult {
  if (!isSearchCursor(input.cursor)) return pageFail("invalid-cursor", "cursor failed structural validation");
  const cursor = input.cursor;
  if (cursor.searchId !== stored.searchId || String(cursor.spaceDigest) !== String(stored.space.digest)) {
    return pageFail("cursor-space-mismatch", "cursor does not belong to this search's space");
  }
  if (cursor.nextIndex !== stored.position) {
    return pageFail(
      "cursor-not-monotonic",
      cursor.nextIndex < stored.position
        ? `cursor regressed to ${cursor.nextIndex}; the stream is at ${stored.position}`
        : `cursor skipped ahead to ${cursor.nextIndex}; the stream is at ${stored.position}`,
    );
  }
  if (cursor.nextIndex >= stored.space.size) {
    return pageFail("cursor-out-of-range", `cursor position ${cursor.nextIndex} is past the end of the space`);
  }
  const limit = pageSizeOf(input.limit);
  if (limit === undefined) {
    return pageFail("invalid-page-size", `limit must be an integer in [1, ${MAX_PAGE_SIZE}]`);
  }
  const traversal = traversalOf(stored.space, stored.request.seed);
  const candidates: SearchedCandidate[] = [];
  const end = Math.min(stored.position + limit, stored.space.size);
  for (let position = stored.position; position < end; position += 1) {
    const candidate = candidateAtPosition(stored.space, traversal, position);
    if (candidate !== undefined) candidates.push(candidate);
  }
  return { ok: true, candidates: Object.freeze(candidates), nextPosition: end, done: end >= stored.space.size };
}

/** Open-oracle refusal helper. */
function fail(code: SearchOpenRefusalCode, detail: string): SessionOpenResult {
  return { ok: false, code, detail };
}

/** Page-oracle refusal helper. */
function pageFail(code: SearchPageRefusalCode, detail: string): SessionPageResult {
  return { ok: false, code, detail };
}
