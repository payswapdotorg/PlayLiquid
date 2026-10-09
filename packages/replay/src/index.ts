/**
 * @playliquid/replay — public surface (PL-014, lock 15 / R8).
 *
 * The platform replay primitive: immutable, content-addressed replay
 * records (game/world snapshot reference + command stream reference +
 * capture range + provenance); a ReplaySource port reusable by players,
 * QA, integrity and Lab (R8); a deterministic re-execution engine that
 * replays a recorded command stream against a runtime session through the
 * canonical command admission gate (E2 — the engine drives a PORT, never
 * importing a runtime, lock 12); and the probabilistic
 * competitive-integrity evidence seam (R11): a verifier port comparing
 * recorded vs re-executed event streams and emitting a typed verdict +
 * confidence. Derivations append artifacts and never rewrite source
 * records (E10).
 *
 * Module map:
 * - artifact-codec.ts  the tagged JSON-safe artifact byte format
 * - command-stream.ts  content-addressed recorded command stream
 * - event-witness.ts   content-addressed recorded event witness + chain
 * - record.ts          the immutable replay record model
 * - source.ts          the ReplaySource port (R8)
 * - fakes.ts           in-memory store + derivation ledger fakes
 * - derivation.ts      append-only derivations (E10)
 * - reexecute.ts       the deterministic re-execution engine + comparison
 * - verifier.ts        the R11 integrity verifier port + reference impl
 */

export type { JsonSafe } from "./artifact-codec.ts";
export {
  encodeGameIRValue,
  decodeGameIRValue,
  encodeCommandEnvelope,
  decodeCommandEnvelope,
  encodeEventEnvelope,
  decodeEventEnvelope,
} from "./artifact-codec.ts";
export type { RecordedCommand, CommandStreamArtifact, CommandStreamVerification } from "./command-stream.ts";
export {
  sealCommandStream,
  verifyCommandStream,
  decodeCommandStreamForm,
} from "./command-stream.ts";
export type { EventWitnessArtifact, EventWitnessVerification } from "./event-witness.ts";
export {
  sealEventWitness,
  verifyEventWitness,
  decodeEventWitnessForm,
  eventEnvelopeForm,
  witnessChainLink,
} from "./event-witness.ts";
export type {
  ReplayProvenance,
  ReplayBoundaryRef,
  ReplayCapture,
  ReplayRecordBody,
  ReplayRecord,
  ReplayRecordValidation,
} from "./record.ts";
export {
  validateReplayRecordBody,
  canonicalReplayBodyForm,
  sealReplayRecord,
  replayRecordIdentity,
} from "./record.ts";
export type { ReplaySource } from "./source.ts";
export type { ReplayDerivation, DerivationLedger } from "./derivation.ts";
export { validateReplayDerivation, sealReplayDerivation, InMemoryDerivationLedger } from "./derivation.ts";
export type {
  TargetSubmission,
  TargetAdvance,
  ReplayTargetSession,
  ReplayTargetLaunch,
  ReplayTargetLauncher,
  ReExecutionErrorCode,
  ReExecutionSuccess,
  ReExecutionResult,
  EventDivergence,
  EventStreamEquality,
} from "./reexecute.ts";
export { reExecuteReplay, compareEventStreams } from "./reexecute.ts";
export type {
  IntegrityVerificationRequest,
  IntegrityVerdict,
  ReplayIntegrityVerifier,
} from "./verifier.ts";
export { createReferenceIntegrityVerifier, deterministicSample } from "./verifier.ts";
export { InMemoryReplayStore } from "./fakes.ts";
