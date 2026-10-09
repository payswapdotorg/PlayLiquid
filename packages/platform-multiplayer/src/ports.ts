/**
 * PORTS — every place an effect would otherwise live behind the kernel's
 * back is a pure interface here, injected by the app and faked in tests.
 *
 * Port list (work-order scope):
 * - {@link AuthoritySimulator} — the "server validates/simulates" seam.
 *   Deliberately NOT an engine: simulation engines are PL-014's world
 *   (packages/simulation). The app wires a deterministic implementation
 *   (fakes.ts provides an in-memory one for tests/harness).
 * - {@link MultiplayerTransport} — client/server messaging sink. The kernel
 *   never opens sockets; it hands typed deliveries to this port.
 * - {@link SessionStore} — snapshot persistence. In-memory fake in tests;
 *   real adapters are app/infrastructure concerns.
 * - {@link AuthorityClock} — the ONLY time source. The kernel never reads a
 *   wall clock (no timers-as-authority); timestamps are inputs.
 * - {@link TickSchedulerPort} — an OUTPUT port: after stepping, the kernel
 *   reports when the next fixed tick is due; the app decides when to drive
 *   `advanceTicks` again. Scheduling authority stays outside the domain.
 *
 * Simulator state contract: `S` must be canonical-JSON round-trippable
 * (objects/arrays/strings/numbers/booleans/null) for byte-stable snapshots.
 *
 * Purity: interfaces + structural data only. No IO anywhere.
 */

import type {
  CommandId,
  CommandSequence,
  DeterminismSeed,
  SessionEpoch,
  SessionId,
  SessionSnapshot,
  SnapshotId,
  Tick,
  Timestamp,
} from "@playliquid/runtime-contracts";
import type {
  RuntimeEventEnvelope,
  TypedIntent,
  AuthoritativeMatchOutcome,
} from "@playliquid/runtime-contracts";
import type { SubjectId } from "@playliquid/platform-contracts";
import type { GameEventKind } from "@playliquid/platform-contracts";
import type { ActorRef } from "@playliquid/runtime-contracts";
import type { MultiplayerTopology } from "./topology.ts";
import type { ClientClaimRefusal } from "./outcomes.ts";

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/** One admitted participant (platform subject bound to a session actor). */
export interface ParticipantView {
  readonly subject: SubjectId;
  readonly actor: ActorRef;
  readonly joinedAtTick: Tick;
}

// ---------------------------------------------------------------------------
// The simulator seam (NOT an engine)
// ---------------------------------------------------------------------------

/** An intent admitted through the canonical command path, handed to the seam. */
export interface AdmittedIntent {
  readonly commandId: CommandId;
  readonly assignedSeq: CommandSequence;
  readonly intent: TypedIntent;
}

/** Input to {@link AuthoritySimulator.initial}. */
export interface SimulationBootstrapInput {
  readonly sessionId: SessionId;
  readonly determinism: DeterminismSeed;
}

/** Input to one authoritative simulation step. */
export interface SimulationStepInput<S> {
  readonly state: S;
  readonly tick: Tick;
  /** Intents executing at this tick, in command-sequence order. */
  readonly intents: readonly AdmittedIntent[];
  /** Participants enrolled when the tick executes. */
  readonly participants: readonly ParticipantView[];
}

/** One simulator-proposed authoritative effect. The kernel commits or refuses it. */
export interface SimulationEffect<P = unknown> {
  /** MUST be a game-declared kind bound to multiplayer (kernel enforces). */
  readonly eventKind: GameEventKind;
  /** Optional attribution (drives protected-grant accounting). */
  readonly actor?: ActorRef;
  /** Optional causal command; must be an admitted command (kernel enforces). */
  readonly causedByCommand?: CommandId;
  readonly payload: P;
}

/** Result of one authoritative simulation step. */
export interface SimulationStepResult<S> {
  readonly state: S;
  readonly effects: readonly SimulationEffect[];
}

/** One final-standing proposal at match end. */
export interface StandingProposal {
  readonly actor: ActorRef;
  readonly score: number;
}

/** Input to {@link AuthoritySimulator.finalize}. */
export interface SimulationFinalInput<S> {
  readonly state: S;
  readonly participants: readonly ParticipantView[];
}

/** Result of {@link AuthoritySimulator.finalize}. */
export interface SimulationFinalResult {
  readonly standings: readonly StandingProposal[];
}

/**
 * THE simulation seam. Implementations must be deterministic functions of
 * their inputs (same state + same tick + same intents -> same result); the
 * determinism seed arrives at `initial`. Engines (PL-014) adapt TO this
 * port; this port never imports them.
 */
export interface AuthoritySimulator<S> {
  readonly initial: (input: SimulationBootstrapInput) => S;
  readonly step: (input: SimulationStepInput<S>) => SimulationStepResult<S>;
  readonly finalize: (input: SimulationFinalInput<S>) => SimulationFinalResult;
}

// ---------------------------------------------------------------------------
// Transport (client/server messaging)
// ---------------------------------------------------------------------------

/** Everything the kernel ever hands to the outside world, typed. */
export type TransportDelivery =
  | {
      readonly kind: "session-opened";
      readonly sessionId: SessionId;
      readonly epoch: SessionEpoch;
      readonly topology: MultiplayerTopology;
    }
  | {
      readonly kind: "participant-admitted";
      readonly sessionId: SessionId;
      readonly subject: SubjectId;
      readonly actor: ActorRef;
    }
  | {
      readonly kind: "participant-refused";
      readonly sessionId: SessionId;
      readonly subject: SubjectId;
      readonly code: string;
      readonly detail: string;
    }
  | {
      readonly kind: "intent-refused";
      readonly sessionId: SessionId;
      readonly code: string;
      readonly detail: string;
    }
  | {
      readonly kind: "events";
      readonly sessionId: SessionId;
      readonly epoch: SessionEpoch;
      readonly events: readonly RuntimeEventEnvelope[];
    }
  | {
      readonly kind: "claim-refused";
      readonly sessionId: SessionId;
      readonly refusal: ClientClaimRefusal;
    }
  | {
      readonly kind: "outcome-decided";
      readonly sessionId: SessionId;
      readonly outcome: AuthoritativeMatchOutcome;
    }
  | {
      readonly kind: "session-terminated";
      readonly sessionId: SessionId;
      readonly reason: string;
    };

/** Messaging port: the app owns wires; the kernel owns the words. */
export interface MultiplayerTransport {
  readonly deliver: (delivery: TransportDelivery) => void;
}

// ---------------------------------------------------------------------------
// Session store (snapshot persistence)
// ---------------------------------------------------------------------------

/** A stored, content-addressed snapshot: boundary record + byte-stable bytes. */
export interface StoredSnapshotRecord {
  readonly snapshot: SessionSnapshot;
  readonly document: string;
}

/** Snapshot persistence port. Save is idempotent (content-addressed ids). */
export interface SessionStore {
  readonly save: (record: StoredSnapshotRecord) => void;
  readonly load: (sessionId: SessionId, snapshotId: SnapshotId) => StoredSnapshotRecord | undefined;
  /** All stored snapshot records of one session (replay boundaries). */
  readonly list: (sessionId: SessionId) => readonly StoredSnapshotRecord[];
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The only time source the kernel will ever consult. */
export interface AuthorityClock {
  readonly now: () => Timestamp;
}

/** Report of when the next fixed tick is due (pure data; no timer inside). */
export interface NextTickDue {
  readonly sessionId: SessionId;
  readonly completedTick: Tick;
  readonly nextTick: Tick;
  readonly tickIntervalMs: number;
}

/** Output port: the app learns the next due tick and drives the next step. */
export interface TickSchedulerPort {
  readonly nextTickDue: (due: NextTickDue) => void;
}
