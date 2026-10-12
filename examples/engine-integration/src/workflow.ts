/**
 * FORGE — the canonical engine workflow driver (PL-038).
 *
 * `runCanonicalEngineWorkflow()` walks the WHOLE engine-native pipeline
 * through REAL public surfaces only, in the staged order of the workflow
 * document:
 *
 *   1. authoring — asset requests through the REAL Blender tool adapter
 *      over the REAL Tool Fabric runtime (source bytes into the
 *      content-addressed exchange, then the staged tool calls);
 *   2. seal (content) — the sealed receipts + the GameIR composition into
 *      the REAL CAS + package registry with R19 provenance; the lock;
 *   3. adjudication — the three REAL engine bindings over the sealed
 *      target profile records (typed verdicts, refusals included);
 *   4. build — the staged build through the REAL build-orchestrator with
 *      the engine fabric port dispatching to the REAL engine.unreal
 *      adapter through the runtime pipeline;
 *   5. seal (game) — the build's CAS artifacts published as the game pack
 *      with R19 provenance; the extended lock verified.
 *
 * Every step appends to the append-only journal (E10) under the injected
 * clock (E9). E9 determinism: running the workflow twice produces
 * byte-identical journals and digests (asserted by the determinism test).
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest } from "../../../packages/package-system/src/index.ts";
import { createWorkflowJournal } from "./journal.ts";
import type { WorkflowJournal } from "./journal.ts";
import { forgeGameDocument, gameDocumentValue } from "./game.ts";
import { forgeWorkflowDocument, workflowDocumentDigest } from "./document.ts";
import type { EngineWorkflowDocument } from "./document.ts";
import { createForgeAdapters, createWorkflowClock } from "./rig.ts";
import type { ForgeAdapters, WorkflowClock } from "./rig.ts";
import { runAuthoringStage } from "./authoring.ts";
import type { AuthoringOutcome } from "./authoring.ts";
import { forgeEngineBindings, forgeProfiles, runAdjudicationStage } from "./adjudication.ts";
import type { AdjudicatedCandidate, EngineBindings, ForgeProfiles } from "./adjudication.ts";
import { openForgeStores, publishBuildOutputs, publishContentPackages, journalPublication, verifyForgeLock } from "./packages.ts";
import type { BuildOutputsPublication, ForgeStores, PublishedContent } from "./packages.ts";
import { composeForgeBuildInputs, createForgeBuildOrchestrator, runForgeBuild } from "./builds.ts";
import type { BuildOutcome } from "./builds.ts";
import { FORGE_TENANT } from "./ids.ts";

/** A typed workflow-level refusal (E8: surfaced, never swallowed). */
export interface WorkflowRefusal {
  readonly ok: false;
  readonly stage: "authoring" | "content" | "adjudication" | "build" | "game";
  readonly code: string;
  readonly message: string;
}

/** The canonical run record: every stage's evidence + the journal. */
export interface CanonicalWorkflowRun {
  readonly ok: true;
  readonly tenant: string;
  readonly document: EngineWorkflowDocument;
  readonly documentDigest: ContentDigest;
  readonly journal: WorkflowJournal;
  readonly authoring: AuthoringOutcome;
  readonly adjudication: readonly AdjudicatedCandidate[];
  readonly content: PublishedContent;
  readonly stores: ForgeStores;
  readonly adapters: ForgeAdapters;
  readonly bindings: EngineBindings;
  readonly profiles: ForgeProfiles;
  readonly build: BuildOutcome;
  readonly game: BuildOutputsPublication;
  /** The content digest sealing the whole evidence trail (E9). */
  readonly evidenceDigest: ContentDigest;
}

/** Journals one entry and advances the clock (deterministic cursor). */
function note(journal: WorkflowJournal, clock: WorkflowClock, stage: string, event: string, detail: unknown): void {
  journal.append({ stage, event, at: clock.now(), detail });
  clock.advanceBy(1_000);
}

/** The canonical engine-native workflow. Deterministic (E9). */
export async function runCanonicalEngineWorkflow(): Promise<CanonicalWorkflowRun | WorkflowRefusal> {
  const journal = createWorkflowJournal();
  const clock = createWorkflowClock();
  const document = forgeWorkflowDocument();
  const documentDigest = workflowDocumentDigest(document);
  note(journal, clock, "document", "workflow-opened", { workflowId: document.workflowId, tenant: FORGE_TENANT, documentDigest });

  // 1. Asset authoring through the real Blender adapter over the runtime.
  const adapters = createForgeAdapters();
  const authoring = await runAuthoringStage(adapters, document, journal, clock);
  if (!authoring.ok) {
    return { ok: false, stage: "authoring", code: authoring.code, message: authoring.message };
  }

  // 2. The sealed receipts + the game composition into the real authorities.
  const stores = await openForgeStores();
  const gameDocument = forgeGameDocument();
  const gameDigest = computeDigest(gameDocumentValue(gameDocument));
  note(journal, clock, "content", "composition-sealed", { gameIrDigest: gameDigest });
  const content = await publishContentPackages(stores, authoring.sealed, gameDocument);
  if (!content.ok) {
    return { ok: false, stage: "content", code: `publication-${content.stage}`, message: `${content.packageId}: ${content.detail}` };
  }
  for (const record of content.records) {
    journalPublication(journal, record, clock.now());
    clock.advanceBy(1_000);
  }
  const contentVerification = verifyForgeLock(stores, content);
  note(journal, clock, "content", "lock-verified", { lockFingerprint: content.lockFingerprint, pass: contentVerification.pass });

  // 3. Engine target adjudication through the real bindings.
  const bindings = forgeEngineBindings();
  const profiles = forgeProfiles();
  const adjudication = runAdjudicationStage(bindings, profiles, document.adjudication);
  for (const candidate of adjudication) {
    note(journal, clock, "adjudication", "binding-verdict", {
      engineId: candidate.engineId,
      profileId: candidate.profileId,
      target: candidate.target,
      compatible: candidate.verdict.compatible,
      ...(candidate.verdict.compatible ? {} : { code: candidate.verdict.code }),
    });
  }

  // 4. The staged build through the real build-orchestrator.
  const pins = {
    gameIrDigest: gameDigest,
    lock: content.lock,
    lockFingerprint: content.lockFingerprint,
    profileDigest: profiles.windows.profileDigest,
    profileTarget: "windows" as const,
    binding: bindings.unreal,
  };
  const composed = composeForgeBuildInputs(pins);
  if (!composed.ok) {
    return { ok: false, stage: "build", code: composed.code, message: composed.message };
  }
  const build = await runForgeBuild({
    orchestrator: createForgeBuildOrchestrator({
      registry: stores.registry,
      cas: stores.artifacts,
      runtime: adapters.runtime,
      inputs: composed.inputs,
      lock: content.lock,
      lockFingerprint: content.lockFingerprint,
      clock,
    }),
    inputs: composed.inputs,
    identity: document.build,
  });
  if (!build.ok) {
    return { ok: false, stage: "build", code: build.code, message: build.message };
  }
  for (const event of build.events) {
    note(journal, clock, "build", "build-event", {
      buildId: build.buildId,
      sequence: event.sequence,
      type: event.type,
      phase: event.phase,
    });
  }
  note(journal, clock, "build", "build-succeeded", { buildId: build.buildId, manifestDigest: build.manifestDigest, artifactCount: build.artifacts.length });

  // 5. The build's artifacts published as the game pack (R19 provenance).
  const game = await publishBuildOutputs(stores, content, build.artifacts);
  if (!game.ok) {
    return { ok: false, stage: "game", code: `publication-${game.stage}`, message: `${game.packageId}: ${game.detail}` };
  }
  journalPublication(journal, game.record, clock.now());
  clock.advanceBy(1_000);
  const gameVerification = verifyForgeLock(stores, { ...content, lock: game.lock, lockFingerprint: game.lockFingerprint });
  note(journal, clock, "seal", "lock-verified", { lockFingerprint: game.lockFingerprint, pass: gameVerification.pass });
  note(journal, clock, "seal", "workflow-complete", { journalDigest: journal.journalDigest });

  return {
    ok: true,
    tenant: FORGE_TENANT,
    document,
    documentDigest,
    journal,
    authoring,
    adjudication,
    content,
    stores,
    adapters,
    bindings,
    profiles,
    build,
    game,
    evidenceDigest: computeDigest({
      documentDigest,
      journalDigest: journal.journalDigest,
      buildId: build.buildId,
      manifestDigest: build.manifestDigest,
      contentLock: content.lockFingerprint,
      gameLock: game.lockFingerprint,
    }),
  };
}
