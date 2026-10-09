/**
 * KERNEL CONTRACTS — construction options, typed results and the internal
 * session-state shape of the authority session kernel (kernel.ts).
 *
 * Split out of kernel.ts to keep every production module under the
 * repository's 400-line ceiling; the kernel class remains the single
 * mutable-state OWNER (E1) — {@link AuthoritySessionState} is the shape of
 * the state it owns, not a second owner.
 */

import type {
  AuthoritativeMatchOutcome,
  CommandId,
  CommandSequence,
  DeterminismSeed,
  OutcomeId,
  RuntimeCommandEnvelope,
  RuntimeEventEnvelope,
  RuntimeSessionPhase,
  RuntimeSessionSnapshotView,
  SessionEpoch,
  SessionId,
  SessionSnapshot,
  Tick,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import type {
  MultiplayerServicePolicy,
  PlatformOutcomeRecord,
  PlatformPolicyDeclaration,
  ProtectedOutcomeKind,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type { ConfigurationRefusalCode } from "./topology.ts";
import type {
  AuthorityClock,
  AuthoritySimulator,
  MultiplayerTransport,
  ParticipantView,
  SessionStore,
  TickSchedulerPort,
} from "./ports.ts";
import type { IntentAdmissionRule, IntentSchema } from "./intents.ts";
import type { ClientClaimRefusal } from "./outcomes.ts";
import type { RefusalRecord } from "./snapshot.ts";

/** Construction options: configuration + the five injected ports. */
export interface AuthoritySessionKernelOptions<S> {
  readonly sessionId: SessionId;
  readonly tenant: TenantId;
  readonly gamePolicy: PlatformPolicyDeclaration;
  readonly servicePolicy: MultiplayerServicePolicy;
  readonly simulator: AuthoritySimulator<S>;
  readonly intentSchemas: readonly IntentSchema[];
  readonly intentRules: readonly IntentAdmissionRule[];
  readonly transport: MultiplayerTransport;
  readonly store: SessionStore;
  readonly clock: AuthorityClock;
  readonly scheduler?: TickSchedulerPort;
  readonly determinism: DeterminismSeed;
  readonly tickIntervalMs: number;
  readonly invitedSubjects?: readonly SubjectId[];
  /**
   * Game-declared semantics: which protected outcome kind each PROTECTED
   * multiplayer event kind grants to its attributed actor. The platform
   * never invents game semantics; unmapped protected events grant nothing.
   */
  readonly protectedGrantKinds?: Readonly<Record<string, ProtectedOutcomeKind>>;
}

/** Result of opening the authoritative session. */
export type OpenResult =
  | { readonly ok: true; readonly sessionView: RuntimeSessionSnapshotView }
  | {
      readonly ok: false;
      readonly code:
        | "already-open"
        | "intent-rules-misaligned"
        | "bad-options"
        | ConfigurationRefusalCode;
      readonly detail: string;
    };

/** Typed result of submitting one intent to the kernel. */
export type IntentSubmitResult =
  | {
      readonly status: "admitted";
      readonly commandId: CommandId;
      readonly assignedSeq: number;
      readonly queuedForTick: Tick;
      readonly receiptEpoch: SessionEpoch;
    }
  | {
      readonly status: "duplicate";
      readonly commandId: CommandId;
      readonly firstReceipt: CommandId;
      readonly receiptEpoch: SessionEpoch;
    }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

/** Result of a fixed-tick advance. */
export type TickResult =
  | {
      readonly ok: true;
      readonly fromTick: number;
      readonly toTick: number;
      readonly eventsEmitted: number;
    }
  | {
      readonly ok: false;
      readonly code: "session-not-open" | "session-terminal" | "session-failed";
      readonly detail: string;
    };

/** Result of the platform-authority outcome decision. */
export type OutcomeDecisionResult =
  | {
      readonly ok: true;
      readonly outcome: AuthoritativeMatchOutcome;
      readonly record: PlatformOutcomeRecord;
    }
  | {
      readonly ok: false;
      readonly code:
        | "session-inactive"
        | "origin-not-authorized"
        | "p2p-cannot-decide-outcomes"
        | "outcome-already-decided"
        | "no-standings"
        | "empty-evidence-chain"
        | "outcome-invalid";
      readonly detail: string;
    };

/** Result of snapshotting. */
export type SnapshotResult =
  | { readonly ok: true; readonly snapshot: SessionSnapshot; readonly documentBytes: number }
  | {
      readonly ok: false;
      readonly code: "session-not-open" | "session-terminal" | "wrong-phase";
      readonly detail: string;
    };

/** Result of restoring. */
export type RestoreResult =
  | {
      readonly ok: true;
      readonly sessionView: RuntimeSessionSnapshotView;
      readonly resumedFromTick: number;
    }
  | {
      readonly ok: false;
      readonly code:
        | "session-not-open"
        | "session-terminal"
        | "wrong-phase"
        | "unknown-snapshot"
        | "corrupt-snapshot"
        | "snapshot-wrong-session";
      readonly detail: string;
    };

/** Result of termination. */
export type TerminateResult =
  | {
      readonly ok: true;
      readonly reason: string;
      readonly outcome: AuthoritativeMatchOutcome | null;
    }
  | {
      readonly ok: false;
      readonly code: "session-not-open" | "session-terminal";
      readonly detail: string;
    };

/** Result of a replay request (R8 seam). */
export type ReplayResult =
  | { readonly ok: true; readonly events: readonly RuntimeEventEnvelope[]; readonly fromSeq: number }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/** Client claim submission result — always a refusal plus advisory data. */
export interface ClientClaimResult {
  readonly refused: true;
  readonly refusal: ClientClaimRefusal;
}

/** One admitted command waiting for its tick. */
export interface PendingCommand {
  readonly envelope: RuntimeCommandEnvelope;
  readonly intent: TypedIntent;
  readonly assignedSeq: CommandSequence;
}

/**
 * The shape of the session state the kernel instance owns (E1). The kernel
 * is the only mutator; everything here is JSON-representable or rebuilt
 * from the snapshot document (document.ts).
 */
export interface AuthoritySessionState<S = unknown> {
  phase: RuntimeSessionPhase;
  epoch: SessionEpoch;
  tick: Tick;
  simulatorState: S | undefined;
  events: RuntimeEventEnvelope[];
  participants: ParticipantView[];
  pending: PendingCommand[];
  idempotency: Map<string, { fingerprint: string; commandId: string }>;
  protectedGrants: Map<string, Set<ProtectedOutcomeKind>>;
  refusals: RefusalRecord[];
  snapshots: SessionSnapshot[];
  perTickIntentCounts: Map<string, number>;
  admittedCommandSeq: number;
  decidedOutcomeId: OutcomeId | null;
}

/** Fresh session state at construction time. */
export function initialAuthoritySessionState<S>(): AuthoritySessionState<S> {
  return {
    phase: "provisioning",
    epoch: 1 as SessionEpoch,
    tick: 0 as Tick,
    simulatorState: undefined,
    events: [],
    participants: [],
    pending: [],
    idempotency: new Map(),
    protectedGrants: new Map(),
    refusals: [],
    snapshots: [],
    perTickIntentCounts: new Map(),
    admittedCommandSeq: 0,
    decidedOutcomeId: null,
  };
}
