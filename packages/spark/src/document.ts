/**
 * THE SPARK BUILD DOCUMENT (PL-035) — the build-contracts-shaped input
 * composition for the spark target.
 *
 * Spark is a TARGET PROFILE, not a second content model (lock rule 16):
 * the composition takes ONE game-ir document (the only content model),
 * ONE sealed spark target profile record (target-profiles' frozen
 * vocabulary — never re-declared), ONE digest-pinned engine binding, ONE
 * toolchain profile and ONE package lock, and produces:
 *
 * - the build-contracts {@link BuildInputs} for target `spark` (the wire
 *   shape the orchestrator's intake admits);
 * - the spark planning digests over the SAME game-ir content (E9): the
 *   boot-plan, stream-schedule and cache-manifest digests composed from
 *   runtime-spark's pure planners, plus the full-document game-ir content
 *   digest the gameIr input cites;
 * - a document digest sealing inputs + spark payload (E9: same inputs
 *   ⇒ same digest, always).
 *
 * Composition is TOTAL (E8): every invalid input is a typed kebab-case
 * refusal with aggregated reasons — a non-spark profile record, a
 * structurally invalid profile, an engine binding that does not declare
 * the spark target, an engine family the profile does not accept, an
 * unpinned binding when the profile pins bindings, and refused boot
 * planning (budget inversion, oversized critical boot, invalid game-ir).
 *
 * Pure module: no IO, no clocks, no globals.
 */

import { canonicalValueForm } from "@playliquid/game-ir";
import type { GameIRDocument, GameIRNode } from "@playliquid/game-ir";
import { computeDigest, computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock } from "@playliquid/package-system";
import { validateTargetProfileRecord } from "@playliquid/target-profiles";
import type { SparkTargetProfileRecord } from "@playliquid/target-profiles";
import { asBuildNonce, asBuildTargetId, asProfileInputId, asRequesterId, validateBuildInputs } from "@playliquid/build-contracts";
import type {
  BuildIdempotencyKey,
  BuildInputs,
  BuildRequestCommand,
  EngineBindingRef,
  ToolchainProfileRef,
} from "@playliquid/build-contracts";
import { isTenantId } from "@playliquid/build-orchestrator";
import type { TenantId } from "@playliquid/build-orchestrator";
import { planSparkBoot, scheduleSparkStreams, buildSparkCacheManifest } from "@playliquid/runtime-spark";
import type { SparkCostModel } from "@playliquid/runtime-spark";

/** What a spark build composes: one document, one profile, one pipeline. */
export interface SparkBuildComposition {
  /** The game-ir document to build (the ONLY content model). */
  readonly document: GameIRDocument;
  /** The sealed spark target profile record (target-profiles vocabulary). */
  readonly profileRecord: SparkTargetProfileRecord;
  /** The digest-pinned engine binding the build cites (caller data). */
  readonly engineBinding: EngineBindingRef;
  /** The toolchain/environment profile the build cites (caller data). */
  readonly toolchain: ToolchainProfileRef;
  /** The package lock pinning the composition's packages. */
  readonly lock: PackageLock;
  /** The boot-planning cost model (planning data, E9). */
  readonly costModel: SparkCostModel;
}

/** Typed spark-build refusal codes (kebab-case, E8). */
export type SparkBuildRefusalCode =
  | "invalid-tenant"
  | "profile-not-spark"
  | "profile-invalid"
  | "engine-binding-unsupported"
  | "engine-binding-not-declared"
  | "engine-binding-not-pinned"
  | "inputs-invalid"
  | "planning-refused";

/** One aggregated typed reason (profile failures + planning rejections). */
export interface SparkBuildReason {
  readonly code: string;
  readonly message: string;
}

/** A typed spark-build refusal. */
export interface SparkBuildRefusal {
  readonly ok: false;
  readonly code: SparkBuildRefusalCode;
  readonly message: string;
  /** Aggregated reasons, when the code carries them (E8 totality). */
  readonly reasons?: readonly SparkBuildReason[];
}

/** The spark planning payload every build result carries (E9 digests). */
export interface SparkBuildPlanPayload {
  /** The sealed spark profile record's own content digest. */
  readonly profileDigest: ContentDigest;
  /** Full-document game-ir content digest (the gameIr input's digest). */
  readonly gameIrDigest: ContentDigest;
  readonly planDigest: ContentDigest;
  readonly scheduleDigest: ContentDigest;
  readonly cacheManifestDigest: ContentDigest;
  /** The boot-planning cost model the digests were derived under (E9). */
  readonly bytesPerMillisecond: number;
  readonly criticalBytes: number;
  readonly deferredUnitCount: number;
  readonly streamBatchCount: number;
  readonly plannedFirstPaintMs: number;
  readonly plannedFirstInteractionMs: number;
}

/** The typed spark build document (build-contracts shaped, spark-pinned). */
export interface SparkBuildDocument {
  /** Discriminator: a document (never a refusal). */
  readonly ok: true;
  readonly kind: "spark-build-document";
  readonly tenant: TenantId;
  readonly target: "spark";
  /** The build-contracts wire inputs for the spark target. */
  readonly inputs: BuildInputs;
  /** The spark planning digests over the same game-ir content (E9). */
  readonly spark: SparkBuildPlanPayload;
  /** Content digest over inputs + spark payload (deterministic, E9). */
  readonly documentDigest: ContentDigest;
}

/** JSON-safe canonical projection of one game-ir node (entity state via game-ir's own canonical form). */
function jsonSafeNode(node: GameIRNode): unknown {
  if (node.kind === "entity") {
    return { ...node, state: canonicalValueForm(node.state) };
  }
  return node;
}

/**
 * The full-document game-ir content digest (E7/E9): SHA-256 over the
 * canonical JSON of the document's JSON-safe projection (package-system
 * is the digest authority; game-ir's canonicalValueForm is the value
 * authority). Deterministic: node order is preserved as authored.
 */
export function sparkGameIrDigestOf(document: GameIRDocument): ContentDigest {
  return computeDigest({
    irVersion: document.irVersion,
    identity: document.identity,
    lifecycle: document.lifecycle ?? "active",
    entry: document.entry,
    nodes: document.nodes.map(jsonSafeNode),
  });
}

/** The document digest input: inputs + spark payload, nothing else. */
function documentDigestInput(inputs: BuildInputs, spark: SparkBuildPlanPayload): unknown {
  return {
    kind: "spark-build-document",
    target: "spark",
    gameIr: inputs.gameIr,
    packageLock: inputs.packageLock,
    targetProfile: inputs.targetProfile,
    engineBinding: inputs.engineBinding,
    toolchain: inputs.toolchain,
    spark,
  };
}

/**
 * THE spark build document composer. Total (E8): profile record, engine
 * binding and boot planning are checked in one pass; every refusal
 * aggregates its reasons. Deterministic (E9): same inputs ⇒ same
 * documentDigest, always.
 */
export function composeSparkBuildDocument(
  tenant: TenantId,
  composition: SparkBuildComposition,
): SparkBuildDocument | SparkBuildRefusal {
  if (!isTenantId(tenant)) {
    return { ok: false, code: "invalid-tenant", message: `tenant "${String(tenant)}" is not a well-formed tenant id` };
  }
  const { profileRecord } = composition;
  if (profileRecord?.target !== "spark") {
    return {
      ok: false,
      code: "profile-not-spark",
      message: `a spark build document requires a spark target profile record, got target "${String(profileRecord?.target)}" (lock rule 16)`,
    };
  }
  const profileValidation = validateTargetProfileRecord(profileRecord);
  if (!profileValidation.ok) {
    return {
      ok: false,
      code: "profile-invalid",
      message: "the spark target profile record failed structural validation (target-profiles oracle)",
      reasons: profileValidation.reasons.map((reason) => ({ code: reason.code, message: reason.message })),
    };
  }
  const binding = composition.engineBinding;
  if (Array.isArray(binding?.supportedTargets) && !binding.supportedTargets.some((target) => String(target) === "spark")) {
    return {
      ok: false,
      code: "engine-binding-unsupported",
      message: `engine binding "${String(binding.engineId)}" declares no support for the spark target`,
    };
  }
  // Mutual consent, profile side: the record's engine-binding compatibility
  // declaration must accept the cited engine family (target-profiles is
  // the profile authority; the full typed oracle composition is the engine
  // adapter family's job — PL-021..PL-024 precedent — so the check here is
  // the profile's own declaration read as data).
  const acceptedEngines = profileRecord.engineBindings.engines as readonly string[];
  if (!acceptedEngines.includes(String(binding?.engineId))) {
    return {
      ok: false,
      code: "engine-binding-not-declared",
      message: `the spark profile record accepts engine families [${acceptedEngines.join(", ")}] but the binding cites "${String(binding?.engineId)}"`,
    };
  }
  const pinned = profileRecord.engineBindings.pinnedBindings;
  if (pinned !== null && !(pinned as readonly string[]).includes(String(binding?.bindingDigest))) {
    return {
      ok: false,
      code: "engine-binding-not-pinned",
      message: "the spark profile record pins exact engine binding digests and the cited binding digest is not among them",
    };
  }
  const planning = planSparkBoot(composition.document, profileRecord.spark, composition.costModel);
  if (!planning.ok) {
    return {
      ok: false,
      code: "planning-refused",
      message: "spark boot planning refused the game-ir content under the spark profile (E8)",
      reasons: planning.rejections.map((rejection) => ({ code: rejection.code, message: rejection.message })),
    };
  }
  const schedule = scheduleSparkStreams(planning.plan, profileRecord.spark);
  if (!schedule.ok) {
    return { ok: false, code: "planning-refused", message: `spark stream scheduling refused: ${schedule.code}` };
  }
  const manifest = buildSparkCacheManifest(planning.plan);
  if (!manifest.ok) {
    return { ok: false, code: "planning-refused", message: `spark cache manifest refused: ${manifest.code}` };
  }
  const gameIrDigest = sparkGameIrDigestOf(composition.document);
  const inputs: BuildInputs = {
    gameIr: { digest: gameIrDigest },
    packageLock: {
      lockFingerprint: computeLockFingerprint(composition.lock),
      pinnedPackageCount: composition.lock.packages.length,
    },
    targetProfile: {
      profileId: asProfileInputId(String(profileRecord.profileId)),
      profileDigest: profileRecord.profileDigest,
      target: asBuildTargetId("spark"),
      vendorGate: { kind: "none" },
    },
    engineBinding: composition.engineBinding,
    toolchain: composition.toolchain,
  };
  const inputValidation = validateBuildInputs(inputs);
  if (!inputValidation.ok) {
    return {
      ok: false,
      code: "inputs-invalid",
      message: "the composed build inputs failed build-contracts structural validation",
      reasons: inputValidation.reasons.map((reason) => ({ code: reason.code, message: reason.message })),
    };
  }
  const spark: SparkBuildPlanPayload = {
    profileDigest: profileRecord.profileDigest,
    gameIrDigest,
    planDigest: planning.plan.planDigest,
    scheduleDigest: schedule.scheduleDigest,
    cacheManifestDigest: manifest.manifestDigest,
    bytesPerMillisecond: composition.costModel.bytesPerMillisecond,
    criticalBytes: planning.plan.budgets.criticalBytes,
    deferredUnitCount: planning.plan.deferredUnits.length,
    streamBatchCount: schedule.batches.length,
    plannedFirstPaintMs: planning.plan.budgets.plannedFirstPaintMs,
    plannedFirstInteractionMs: planning.plan.budgets.plannedFirstInteractionMs,
  };
  return {
    ok: true,
    kind: "spark-build-document",
    tenant,
    target: "spark",
    inputs,
    spark,
    documentDigest: computeDigest(documentDigestInput(inputs, spark)),
  };
}

/** The identity of a spark build request (idempotency + timing, caller data). */
export interface SparkBuildRequestIdentity {
  readonly requester: string;
  readonly nonce: string;
  readonly requestedAt: number;
}

/**
 * Projects a spark build document into the build-contracts
 * {@link BuildRequestCommand} the orchestrator's intake admits. The
 * request parameters are a GameIR record value carrying the planning
 * inputs (target profile + cost model) so the request FINGERPRINT pins
 * everything the spark digests were derived under (E9 reproducibility).
 */
export function sparkBuildRequestOf(document: SparkBuildDocument, identity: SparkBuildRequestIdentity): BuildRequestCommand {
  const idempotency: BuildIdempotencyKey = {
    scope: "build-request",
    requester: asRequesterId(identity.requester),
    nonce: asBuildNonce(identity.nonce),
  };
  return {
    kind: "request-build",
    idempotency,
    inputs: document.inputs,
    parameters: {
      kind: "record",
      fields: {
        "target-profile": { kind: "string", value: "spark" },
        "bytes-per-millisecond": { kind: "float", value: document.spark.bytesPerMillisecond },
      },
    },
    requestedAt: identity.requestedAt,
  };
}
