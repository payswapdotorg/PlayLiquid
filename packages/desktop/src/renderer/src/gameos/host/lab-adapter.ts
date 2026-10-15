/**
 * THE LAB PORT ADAPTERS (RW-001): the desktop host's implementations of
 * gameos-lab's two seams — `LabDataPort` (read models) and
 * `LabCommandPort` (typed intents → authoritative Lab doors).
 *
 * The data port assembles the viewer-scoped Lab snapshot through the
 * authoritative services' own public read doors (organization document +
 * listEvidence, learning listLearningCycles / deriveSignals /
 * deriveSearchGuidance / summarizeGaps). The candidate streams are the
 * host-owned walk of each search session: every `load()` pages the
 * session's single-use monotonic cursor forward and APPENDS the emitted
 * candidates to a host-side per-search log (E10 append-only — a refresh
 * never drops an already-emitted candidate, E11). The Arena surface is
 * honestly empty: the desktop host configures no external Arena
 * connection, so zero escalation cases exist.
 *
 * The command port expands the small UI intents into full authoritative
 * commands using the HOST's own catalogs (identity.ts: the local operator
 * tenancy, the opaque ZCode model route, the local role vocabulary, the
 * build-revision game identity) — the UI never fabricates catalogs (E13).
 * Refusals carry the authoritative packages' own codes verbatim (E8).
 */

import type {
  LabCommandIntent,
  LabCommandLogEntry,
  LabCommandPort,
  LabCommandReceipt,
  LabDataPort,
  LabLoadResult,
} from "../../../../../../web/gameos-lab/src/index.ts";
import type { LabDataSnapshot, LabViewer } from "../../../../../../web/gameos-lab/src/index.ts";
import type {
  GapLadderRung,
  GapRungAttempt,
} from "../../../../../../lab-contracts/src/index.ts";
import type { OrganizationSearchRequest } from "../../../../../../lab-organization/src/index.ts";
import type { SearchedCandidate } from "../../../../../../lab-organization/src/index.ts";
import type { LabLearningService } from "../../../../../../lab-learning/src/index.ts";
import type { LabOrganizationService } from "../../../../../../lab-organization/src/index.ts";
import type { GameIdentity } from "../../../../../../game-contracts/src/index.ts";
import { LOCAL_MODEL_ROUTE, LOCAL_ROLE_VOCABULARY } from "../identity.ts";

/**
 * The Lab facts these adapters read from the composed host — a local
 * STRUCTURAL slice, not the host type itself, so the adapters never import
 * their composer and the module graph stays acyclic (the composed host
 * object satisfies this shape structurally; desktop-host.ts owns the real
 * type). The clock is the host's wall clock (adapters.ts DesktopHostClock).
 */
type LabHostFacts = {
  readonly viewer: LabViewer;
  readonly clock: { now(): number };
  readonly lab: {
    readonly organization: LabOrganizationService;
    readonly learning: LabLearningService;
  };
  readonly localProjectIdentity: () => GameIdentity | undefined;
};

/** The caller shape every Lab door takes (tenant + subject; R20 scope). */
function callerOf(host: LabHostFacts): LabViewer {
  return { tenant: host.viewer.tenant, subject: host.viewer.subject };
}

/** True when `rung` is one of the autonomous ladder rungs. */
function isAutonomousRung(rung: GapLadderRung): boolean {
  return (
    rung === "existing-organization" ||
    rung === "alternate-organization" ||
    rung === "package-platform-capability"
  );
}

/**
 * The desktop `LabDataPort`: pulls one authoritative, viewer-scoped Lab
 * read-model snapshot (the frozen PL-034 mount recipe: the host loads the
 * FIRST snapshot before the store exists).
 */
export class DesktopLabDataPort implements LabDataPort {
  readonly #host: () => LabHostFacts;
  /** The host-owned candidate log per search id (append-only, E10). */
  readonly #streams = new Map<string, SearchedCandidate[]>();

  constructor(host: () => LabHostFacts) {
    this.#host = host;
  }

  load(): LabLoadResult {
    const host = this.#host();
    const caller = callerOf(host);
    const document = host.lab.organization.document();
    const searches = document.searches.filter(
      (search) => String(search.tenant) === String(caller.tenant),
    );
    const candidateStreams: Record<string, readonly SearchedCandidate[]> = {};
    for (const search of searches) {
      candidateStreams[search.searchId] = this.#walk(search.searchId, search.space.digest, search.position);
    }
    const learning = host.lab.learning.listLearningCycles(caller);
    const signals = host.lab.learning.deriveSignals(caller);
    const observed = host.lab.learning.deriveSearchGuidance(caller, { mode: "observed-only" });
    const estimates = host.lab.learning.deriveSearchGuidance(caller, { mode: "with-estimates" });
    const snapshot: LabDataSnapshot = {
      viewer: caller,
      searches,
      candidateStreams,
      evidence: host.lab.organization.listEvidence(caller),
      learningRecords: learning,
      ...(signals.ok ? { signals: signals.signals } : {}),
      guidance: [
        ...(observed.ok ? [observed.guidance] : []),
        ...(estimates.ok ? [estimates.guidance] : []),
      ],
      gapSummaries: host.lab.learning.summarizeGaps(caller),
      arenaCases: [],
    };
    return { ok: true, data: snapshot };
  }

  /**
   * Pages the session's stream forward from its current position and
   * appends the emitted candidates to the host-owned log. A page refusal
   * (typed, E8) ends the walk for THIS load — the log keeps every
   * candidate emitted so far (nothing is dropped silently, E11).
   */
  #walk(searchId: string, spaceDigest: string, position: number): readonly SearchedCandidate[] {
    const host = this.#host();
    const caller = callerOf(host);
    let log = this.#streams.get(searchId);
    if (log === undefined) {
      log = [];
      this.#streams.set(searchId, log);
    }
    let cursor = { kind: "search-cursor" as const, searchId, spaceDigest, nextIndex: position };
    for (let guard = 0; guard < 4096; guard += 1) {
      const page = host.lab.organization.nextCandidates({ searchId, cursor, limit: 64, as: caller });
      if (!page.ok) break;
      log.push(...page.candidates);
      if (page.done || page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    return log;
  }
}

/**
 * The desktop `LabCommandPort`: forwards typed UI intents to the
 * authoritative Lab doors (or refuses them with the UI seam's own
 * `invalid-intent` code before any domain call).
 */
export class DesktopLabCommandPort implements LabCommandPort {
  readonly #host: () => LabHostFacts;

  constructor(host: () => LabHostFacts) {
    this.#host = host;
  }

  dispatch(intent: LabCommandIntent): LabCommandReceipt {
    const host = this.#host();
    const caller = callerOf(host);
    if (intent.kind === "request-search") {
      return this.#requestSearch(host, caller, intent);
    }
    return this.#advanceGapRung(host, caller, intent);
  }

  /** Expands a request-search intent into a full authoritative request. */
  #requestSearch(
    host: LabHostFacts,
    caller: LabViewer,
    intent: Extract<LabCommandIntent, { kind: "request-search" }>,
  ): LabCommandReceipt {
    const identity = host.localProjectIdentity();
    if (identity === undefined) {
      return {
        ok: false,
        code: "invalid-context",
        detail:
          "the desktop host has no pinned local project revision (no build commit) — the Lab cannot organize a search context; build the app from a git revision",
      };
    }
    const request: OrganizationSearchRequest = {
      tenant: caller.tenant,
      owner: caller.subject,
      cycleId: intent.cycleId as OrganizationSearchRequest["cycleId"],
      context: {
        game: identity,
        phase: "release",
        taskDifficulty: "moderate",
      },
      bounds: {
        maxAgents: intent.maxAgents,
        roleVocabulary: [...LOCAL_ROLE_VOCABULARY],
        bodyCatalog: [],
        modelCatalog: [{ authority: "zcode-model-routing", route: LOCAL_MODEL_ROUTE }],
        toolCatalog: [],
        capabilityVocabulary: [],
      },
      seed: intent.seed as OrganizationSearchRequest["seed"],
      requestedAt: host.clock.now() as OrganizationSearchRequest["requestedAt"],
    };
    const opened = host.lab.organization.openSearch(request);
    if (!opened.ok) {
      return { ok: false, code: opened.code, detail: opened.detail };
    }
    return {
      ok: true,
      kind: "search-opened",
      searchId: opened.searchId,
      size: opened.size,
      spaceDigest: opened.spaceDigest,
      position: opened.position,
      duplicate: opened.duplicate,
    };
  }

  /** Expands an advance-gap-rung intent into a full rung attempt. */
  #advanceGapRung(
    host: LabHostFacts,
    caller: LabViewer,
    intent: Extract<LabCommandIntent, { kind: "advance-gap-rung" }>,
  ): LabCommandReceipt {
    let attempt: GapRungAttempt;
    if (intent.rung === "blocked") {
      attempt = { rung: intent.rung, reason: intent.disposition };
    } else if (isAutonomousRung(intent.rung)) {
      if (intent.disposition === "declined") {
        return {
          ok: false,
          code: "invalid-intent",
          detail:
            "the autonomous ladder rungs accept only attempted/unavailable dispositions — declined is reserved for the human-participation rungs",
        };
      }
      attempt = { rung: intent.rung, disposition: intent.disposition };
    } else {
      attempt = { rung: intent.rung, disposition: intent.disposition };
    }
    if (intent.outcome !== undefined) {
      attempt = { ...attempt, outcome: intent.outcome };
    }
    const advanced = host.lab.organization.advanceCapabilityGap({
      gapId: intent.gapId,
      attempt,
      as: caller,
    });
    if (!advanced.ok) {
      return { ok: false, code: advanced.code, detail: advanced.detail };
    }
    return {
      ok: true,
      kind: "gap-advanced",
      gapId: intent.gapId,
      rung: intent.rung,
      duplicate: false,
    };
  }
}

/** Re-export for component/test convenience (the append-only log shape). */
export type { LabCommandLogEntry };
