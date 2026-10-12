/**
 * DETERMINISTIC IN-MEMORY FAKES + THE JOURNEY STACK (PL-031) — tests and
 * the harness.
 *
 * Everything here is deterministic (E9): the fixed clock steps by a
 * constant; the fake Arena answers from a PURE responder whose responses
 * are content-derived (same request envelope → same response envelope, same
 * digests); fixture sources are digest-derived. No IO beyond the in-memory
 * maps arena-integration's own fake transport performs.
 *
 * The fake Arena is NOT a real provider and never claimed to be one (E11,
 * lock 44): it is the deterministic responder behind arena-integration's
 * `inMemoryArenaTransport` port — the same port a host-side real provider
 * binds. It computes response digests with the runtime's pinned canonical
 * rule (digest.ts) so tampering is testable.
 */

import { inMemoryArenaTransport, requestKindArtifactClass } from "@playliquid/arena-integration";
import type {
  ArenaEndpointRef,
  ArenaRequestEnvelope,
  ArenaResponseEnvelope,
  ArenaTransport,
} from "@playliquid/arena-integration";
import { allowAllArenaPolicy, arenaAuthorizationScopeKey } from "@playliquid/arena-integration";
import type { ArenaEscalationId, ContentDigest, GapRecordId, LabCycleId, OrganizationId } from "@playliquid/lab-contracts";
import { asArenaEscalationId, asGapRecordId, asLabCycleId, asOrganizationId, asTimestampMs } from "@playliquid/lab-contracts";
import type { GapLadderSummary } from "@playliquid/lab-learning";
import type { CapabilityGapFinding } from "@playliquid/lab-organization";
import type { CapabilityGapRecord } from "@playliquid/lab-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { arenaDecisionDigestOf, arenaDigestOf, arenaResponseDigestOf, runtimeDigestOf } from "./digest.ts";
import type { ArenaEscalationCommand } from "./records.ts";
import type { ArenaRuntimeDocument, ArenaRuntimeStore } from "./ports.ts";
import { ArenaRuntimeService } from "./service.ts";

/** Domain-separation tag for fake-Arena response content. */
const FAKE_TAG = "playliquid:arena-runtime:fake-arena:1";

// ---------------------------------------------------------------------------
// Clock + store fakes
// ---------------------------------------------------------------------------

/** A deterministic stepping clock: now(), now()+step, now()+2*step, … */
export function createSteppingClock(startMs: number, stepMs = 1): { now(): number } {
  let current = startMs;
  return {
    now(): number {
      const value = current;
      current += stepMs;
      return value;
    },
  };
}

/** An in-memory document store holding the last snapshot (E6 fake). */
export function createArenaRuntimeStore(): ArenaRuntimeStore & { snapshots(): readonly ArenaRuntimeDocument[] } {
  const saved: ArenaRuntimeDocument[] = [];
  return {
    save(document: ArenaRuntimeDocument): void {
      saved.push(document);
    },
    load(): ArenaRuntimeDocument | undefined {
      return saved[saved.length - 1];
    },
    snapshots(): readonly ArenaRuntimeDocument[] {
      return Object.freeze([...saved]);
    },
  };
}

// ---------------------------------------------------------------------------
// The deterministic fake Arena (behind arena-integration's transport port)
// ---------------------------------------------------------------------------

/** The fake Arena's fixture endpoint (digest-pinned identity). */
export function fakeArenaEndpoint(): ArenaEndpointRef {
  const digest = runtimeDigestOf({ tag: FAKE_TAG, endpoint: true });
  return Object.freeze({ refKind: "arena-endpoint", endpointDigest: arenaDigestOf(digest)! });
}

/** Builds the fake Arena's deterministic, digest-pinned response to one request. */
export function fakeArenaResponseTo(envelope: ArenaRequestEnvelope, endpoint: ArenaEndpointRef): ArenaResponseEnvelope {
  const resultContent = runtimeDigestOf({ tag: FAKE_TAG, result: true, requestPayload: envelope.cycle.requestPayload });
  const resultWire = arenaDigestOf(resultContent)!;
  const artifactClass = requestKindArtifactClass(envelope.requestKind);
  const results = [
    Object.freeze({
      recordKind: "arena-result" as const,
      origin: "arena-external" as const,
      content: resultWire,
    }),
  ];
  const evidence = [
    Object.freeze({
      recordKind: "arena-evidence" as const,
      origin: "arena-external" as const,
      evidence: [arenaDigestOf(runtimeDigestOf({ tag: FAKE_TAG, evidence: true, requestPayload: envelope.cycle.requestPayload }))!],
      substantiates: [resultWire],
    }),
  ];
  const artifacts =
    artifactClass === undefined
      ? []
      : [
          Object.freeze({
            recordKind: "arena-artifact" as const,
            origin: "arena-external" as const,
            artifactClass,
            artifact: arenaDigestOf(runtimeDigestOf({ tag: FAKE_TAG, artifact: true, requestPayload: envelope.cycle.requestPayload, artifactClass }))!,
          }),
        ];
  const content = {
    envelopeKind: "arena-response" as const,
    requestPayload: envelope.cycle.requestPayload,
    respondent: endpoint,
    results,
    evidence,
    artifacts,
  };
  return Object.freeze({ ...content, responseDigest: arenaResponseDigestOf(content) });
}

/** A deterministic fake Arena serving exactly one digest-pinned endpoint. */
export function createFakeArena(endpoint: ArenaEndpointRef): ArenaTransport & { sentEnvelopes(): readonly ArenaRequestEnvelope[] } {
  return inMemoryArenaTransport({
    endpoint,
    respond: (envelope) => ({ ok: true, response: fakeArenaResponseTo(envelope, endpoint) }),
  });
}

// ---------------------------------------------------------------------------
// Fixture sources (digest-derived, ladder-walked)
// ---------------------------------------------------------------------------

/** A valid walked gap record whose trail reached the user/community rung. */
export function fixtureWalkedGapRecord(seed: string, missingCapability = "render-pipeline"): CapabilityGapRecord {
  const base = runtimeDigestOf({ tag: FAKE_TAG, gap: true, seed, missingCapability });
  const gapId = asGapRecordId(`gap-${base.slice(0, 54)}`)!;
  const cycleId = asLabCycleId(`lab-cycle-${base.slice(0, 50)}`)!;
  const currentOrg = asOrganizationId(`org-base-${base.slice(0, 52)}`)!;
  return {
    gapId,
    cycleId,
    missingCapability,
    summary: `fixture gap ${seed}: ${missingCapability} is missing and the ladder was walked to the community rung`,
    openedAt: asTimestampMs(1_000)!,
    attempts: [
      { rung: "existing-organization", disposition: "unavailable", outcome: "unresolved", organization: currentOrg },
      { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" },
      { rung: "package-platform-capability", disposition: "unavailable", outcome: "unresolved" },
      { rung: "user-community-contribution", disposition: "declined" },
    ],
  };
}

/** A lab-organization finding matching a walked gap record. */
export function fixtureGapFinding(record: CapabilityGapRecord): CapabilityGapFinding {
  const base = runtimeDigestOf({ tag: FAKE_TAG, finding: true, gapId: String(record.gapId) });
  return {
    missingCapability: record.missingCapability,
    currentOrganization: asOrganizationId(`org-base-${base.slice(0, 52)}`)!,
    candidateOrganization: asOrganizationId(`org-cand-${base.slice(0, 53)}`)!,
    candidateDigest: base,
  };
}

/** A lab-learning rung-classified recurring summary at the community rung. */
export function fixtureGapSummary(missingCapability = "render-pipeline"): GapLadderSummary {
  const base = runtimeDigestOf({ tag: FAKE_TAG, summary: true, missingCapability });
  return {
    missingCapability,
    currentRung: "user-community-contribution",
    reachedRungs: ["existing-organization", "alternate-organization", "package-platform-capability", "user-community-contribution"],
    rungAttemptCounts: [
      { rung: "existing-organization", attempts: 2 },
      { rung: "alternate-organization", attempts: 2 },
      { rung: "package-platform-capability", attempts: 1 },
      { rung: "user-community-contribution", attempts: 1 },
    ],
    recurrenceCount: 2,
    gapIds: [String(asGapRecordId(`gap-${base.slice(0, 54)}`)!)],
    cycleIds: [asLabCycleId(`lab-cycle-${base.slice(0, 50)}`)!, asLabCycleId(`lab-cycle-${base.slice(50, 100)}`)!],
    resolved: false,
    blocked: false,
    recurring: true,
  };
}

/** A fixture escalation id (the opaque external handle shape). */
export function fixtureEscalationId(seed: string): ArenaEscalationId {
  const base = runtimeDigestOf({ tag: FAKE_TAG, escalation: true, seed });
  return asArenaEscalationId(`arena-esc-${base.slice(0, 52)}`)!;
}

/** A fixture content digest (the bare-hex ask form). */
export function fixtureAskDigest(seed: string): ContentDigest {
  return runtimeDigestOf({ tag: FAKE_TAG, ask: true, seed });
}

// ---------------------------------------------------------------------------
// The journey stack (tests + harness wiring)
// ---------------------------------------------------------------------------

/** Everything a test/harness needs to walk one escalation end-to-end. */
export interface ArenaRuntimeJourney {
  readonly service: ArenaRuntimeService;
  readonly caller: { readonly tenant: TenantId; readonly subject: SubjectId };
  readonly store: ReturnType<typeof createArenaRuntimeStore>;
  readonly clock: ReturnType<typeof createSteppingClock>;
  readonly arena: ArenaTransport & { sentEnvelopes(): readonly ArenaRequestEnvelope[] };
  readonly endpoint: ArenaEndpointRef;
  /** A decided escalation command citing the registered gap-finding source. */
  readonly decidedCommand: (overrides?: Partial<Omit<ArenaEscalationCommand, "sourceKey">>) => ArenaEscalationCommand;
  readonly gapSourceKey: string;
}

/** Wires a full deterministic journey: registry, decided command, fake Arena. */
export function createArenaRuntimeJourney(options?: {
  readonly tenant?: string;
  readonly requestKind?: ArenaEscalationCommand["requestKind"];
}): ArenaRuntimeJourney {
  const tenant = asTenantId(options?.tenant ?? "tenant-alpha")!;
  const caller = { tenant, subject: asSubjectId("operator-1")! };
  const store = createArenaRuntimeStore();
  const clock = createSteppingClock(10_000, 1);
  const endpoint = fakeArenaEndpoint();
  const arena = createFakeArena(endpoint);
  const service = new ArenaRuntimeService({
    ports: {
      clock,
      store,
      policy: allowAllArenaPolicy("lab-usage-rules-fixture"),
      transport: arena,
    },
  });
  const record = fixtureWalkedGapRecord("journey");
  const finding = fixtureGapFinding(record);
  const registered = service.registerSource(caller, { kind: "gap-finding", finding, record });
  if (!registered.ok) throw new Error(`fixture source registration refused: ${registered.detail}`);
  const gapSourceKey = String(registered.source.sourceKey);
  const decidedCommand = (overrides?: Partial<Omit<ArenaEscalationCommand, "sourceKey">>): ArenaEscalationCommand => {
    const base: ArenaEscalationCommand = {
      decidedBy: caller.subject,
      decidedAt: asTimestampMs(12_000)!,
      decisionDigest: fixtureAskDigest("placeholder"),
      sourceKey: registered.source.sourceKey,
      requestKind: options?.requestKind ?? "result",
      requestPayload: fixtureAskDigest("journey-ask"),
      endpoint,
      authorization: { scopeKind: "arena-authorization-scope", artifactClasses: [] },
    };
    const command = { ...base, ...overrides };
    return { ...command, decisionDigest: arenaDecisionDigestOf({
      tenant: String(tenant),
      decidedBy: String(command.decidedBy),
      decidedAt: command.decidedAt,
      sourceKey: String(command.sourceKey),
      requestKind: command.requestKind,
      requestPayload: String(command.requestPayload),
      endpointDigest: String(command.endpoint.endpointDigest),
      authorizationKey: arenaAuthorizationScopeKey(command.authorization),
    }) };
  };
  return { service, caller, store, clock, arena, endpoint, decidedCommand, gapSourceKey };
}

/** Type re-exports for test wiring. */
export type { GapRecordId, LabCycleId, OrganizationId };
