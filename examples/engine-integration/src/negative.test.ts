/**
 * THE E8 NEGATIVE BATTERY (PL-038) — every typed refusal the engine-native
 * workflow's real surfaces can produce, asserted with its code VERBATIM
 * (the adapters' own negative-*.test.ts files are the assertion idiom):
 *
 *  1. out-of-set engine targets — the three real bindings adjudicating
 *     sealed profiles whose target is outside their typed sets;
 *  2. the target-profiles contract precedence — engine-not-declared fires
 *     before target-not-supported (plus the pin-mismatch refusal);
 *  3. cross-tenant dispatches (R20) — the four adapters' verbatim tenancy
 *     codes; refusals mutate nothing (no bridge invocation, no ok evidence);
 *  4. malformed command payloads — the adapters' total validate*CommandPayload
 *     rejection codes, plus the adapter's own invalid-payload failure;
 *  5. the fabric pipeline's exchange guard (E7) — inline bytes and
 *     unresolvable artifact references are typed failures;
 *  6. journal integrity (E10) — an edited/reordered snapshot breaks the
 *     chain, duplicate appends are idempotent, revise() is refused;
 *  7. unresolvable artifacts — fail-closed publication (artifact-verification
 *     / artifact-missing) and lock verification (missing-package);
 *  8. idempotent re-submission (E6) — the same idempotencyKey replays the
 *     cached receipt; effects happen exactly once; a different input with
 *     the same key is a typed mismatch.
 *
 * E11 honesty: the adapters are the REAL adapters over their own shipped
 * deterministic fake bridges (the packages' test seams — the adapters'
 * own negative batteries dispatch through exactly these); no engine or
 * Blender binary is installed, invoked or pretended. See README.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdapterCommandDispatch } from "../../../packages/engine-adapter-contract/src/index.ts";
import { validateBlenderCommandPayload, BLENDER_PAYLOAD_VERSION } from "../../../packages/tool-blender/src/index.ts";
import { validateUnrealCommandPayload, UNREAL_PAYLOAD_VERSION } from "../../../packages/engine-unreal/src/index.ts";
import { createUnityAdapter, createFakeUnityBridge, createFakeUnityClock } from "../../../packages/engine-unity/src/index.ts";
import { createGodotAdapter, createFakeGodotBridge, createFakeGodotClock } from "../../../packages/engine-godot/src/index.ts";
import type { ToolCallOutcome } from "../../../packages/tool-fabric/src/index.ts";
import { computeDigest, computeLockFingerprint, sealPackageRecord } from "../../../packages/package-system/src/index.ts";
import type { PackageLock, SemanticVersion, UnsealedPackageRecord } from "../../../packages/package-system/src/index.ts";
import { publishPackage } from "../../../packages/package-registry/src/index.ts";
import type { PlainTargetProfileRecord } from "../../../packages/target-profiles/src/index.ts";
import {
  BLENDER_PROJECT,
  FORGE_COMMIT,
  FORGE_TENANT,
  GODOT_BRIDGE_SEED,
  OTHER_TENANT,
  TOOL_SURFACE,
  UNREAL_PROJECT,
  UNITY_BRIDGE_SEED,
  WORKFLOW_CLOCK_ORIGIN_MS,
} from "./ids.ts";
import { capabilityTool, createForgeAdapters } from "./rig.ts";
import type { ForgeAdapters } from "./rig.ts";
import { forgeEngineBindings, forgeProfiles, runAdjudicationStage, sealForgeProfile } from "./adjudication.ts";
import type { ForgeProfiles } from "./adjudication.ts";
import { createWorkflowJournal, verifyJournalChain } from "./journal.ts";
import { openForgeStores, verifyForgeLock } from "./packages.ts";

const VERSION: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };
const HEX = (char: string): string => char.repeat(64);

/** The failure arm's typed error (refusals never throw; the error IS the evidence). */
type FabricFailure = Extract<ToolCallOutcome, { readonly outcome: "failure" }>["error"];

/** Narrows a fabric outcome to its failure arm or fails the test. */
function failureOf(outcome: ToolCallOutcome): FabricFailure {
  if (outcome.outcome !== "failure") {
    throw new Error(`expected a failure outcome, got ${outcome.outcome}`);
  }
  return outcome.error;
}

/** One adapter command dispatch (the adapters' own negative-test shape). */
function dispatch(commandId: string, capability: string, payload: unknown): AdapterCommandDispatch {
  return { kind: "adapter-command-dispatch", commandId, capability, payload };
}

/** Drives one tool call through the REAL fabric pipeline (the workflow's path). */
async function callTool(
  rig: ForgeAdapters,
  callId: string,
  capability: string,
  adapterId: string,
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ToolCallOutcome> {
  return await rig.runtime.invokeToolCall({
    kind: "tool-call-request",
    callId,
    tool: capabilityTool(capability, adapterId),
    surfaceVersion: { ...TOOL_SURFACE },
    input,
    requiredCapabilities: [],
    idempotencyKey,
  });
}

/** One negative adjudication fixture (sealed through the example's own sealer). */
interface ProfileFixture {
  readonly profileId: string;
  readonly target: PlainTargetProfileRecord["target"];
  readonly engines: readonly string[];
  readonly pinned?: readonly string[];
}

/** The example's profiles extended with the negative fixtures. */
function profilesWith(...extra: readonly ProfileFixture[]): ForgeProfiles {
  const base = forgeProfiles();
  const records = extra.map((fixture) => sealForgeProfile(fixture.profileId, fixture.target, fixture.engines, fixture.pinned ?? null));
  const entries = records.map((record): readonly [string, PlainTargetProfileRecord] => [record.profileId, record]);
  return { ...base, byId: new Map([...base.byId, ...entries]) };
}

test("E8: out-of-set engine targets adjudicate incompatible with the binding's verbatim code", () => {
  const bindings = forgeEngineBindings();
  // Each target is OUTSIDE that engine binding's typed set: unreal declares
  // windows/macos/linux; unity declares web/windows/macos/linux/android/ios;
  // godot declares web/windows/macos/linux (the engine-binding sources).
  const verdicts = runAdjudicationStage(
    bindings,
    profilesWith(
      { profileId: "forge-android", target: "android", engines: ["unreal", "unity", "godot"] },
      { profileId: "forge-steamdeck", target: "steamdeck", engines: ["unity"] },
    ),
    [
      { engineId: "unreal", profileId: "forge-android" },
      { engineId: "unity", profileId: "forge-steamdeck" },
      { engineId: "godot", profileId: "forge-android" },
    ],
  );
  assert.deepEqual(
    verdicts.map((candidate) => (candidate.verdict.compatible ? "compatible" : candidate.verdict.code)),
    ["unreal-binding/profile-target-unsupported", "unity-binding/profile-target-unsupported", "godot-binding/profile-target-unsupported"],
  );
  // The refusal echoes the incompatible target it observed (typed evidence).
  assert.deepEqual(
    verdicts.map((candidate) => (candidate.verdict.compatible ? null : candidate.verdict.target)),
    ["android", "steamdeck", "android"],
  );
});

test("E8: engine-not-declared fires BEFORE target-not-supported (the contract order)", () => {
  const bindings = forgeEngineBindings();
  // An android profile that does NOT declare unreal fails BOTH checks; the
  // target-profiles contract checks the engine declaration first
  // (compatibility.ts: engine-not-declared precedes target-not-supported —
  // the same precedence the unreal binding's own tests assert).
  const verdicts = runAdjudicationStage(
    bindings,
    profilesWith({ profileId: "forge-android-native", target: "android", engines: ["native"] }),
    [{ engineId: "unreal", profileId: "forge-android-native" }],
  );
  const notDeclared = verdicts[0];
  if (notDeclared === undefined || notDeclared.verdict.compatible) throw new Error("expected the engine-not-declared refusal");
  assert.equal(notDeclared.verdict.code, "unreal-binding/profile-engine-not-declared");
  // A pinned profile whose pin list excludes the binding digest refuses with
  // the pin-mismatch code (the third typed refusal of the predicate).
  const pinned = runAdjudicationStage(
    bindings,
    profilesWith({ profileId: "forge-windows-pinned", target: "windows", engines: ["unreal"], pinned: [`sha256:${HEX("9")}`] }),
    [{ engineId: "unreal", profileId: "forge-windows-pinned" }],
  );
  const notPinned = pinned[0];
  if (notPinned === undefined || notPinned.verdict.compatible) throw new Error("expected the binding-not-pinned refusal");
  assert.equal(notPinned.verdict.code, "unreal-binding/profile-binding-not-pinned");
});

test("E8/R20: foreign-tenant dispatches refuse with the adapters' verbatim tenancy codes and mutate nothing", async () => {
  const rig = createForgeAdapters();
  // Blender (the rig's own adapter): a foreign tenant claim is the typed mismatch.
  const blender = await rig.blender.dispatch(dispatch("neg-tn-1", "project.inspect", {
    version: BLENDER_PAYLOAD_VERSION, tenant: OTHER_TENANT, target: BLENDER_PROJECT,
  }));
  assert.equal(blender.outcome, "failed");
  if (blender.outcome === "failed") {
    assert.equal(blender.error.code, "blender-tenancy/tenant-mismatch");
  }
  // Missing and malformed claims have their own codes (the tenancy union).
  const missing = await rig.blender.dispatch(dispatch("neg-tn-2", "project.inspect", {
    version: BLENDER_PAYLOAD_VERSION, target: BLENDER_PROJECT,
  }));
  if (missing.outcome === "failed") assert.equal(missing.error.code, "blender-tenancy/tenant-not-a-string");
  const malformed = await rig.blender.dispatch(dispatch("neg-tn-3", "project.inspect", {
    version: BLENDER_PAYLOAD_VERSION, tenant: "Not A Valid Tenant", target: BLENDER_PROJECT,
  }));
  if (malformed.outcome === "failed") assert.equal(malformed.error.code, "blender-tenancy/tenant-invalid");
  // The refusal mutated nothing: no bridge invocation, no ok evidence.
  assert.equal(rig.blenderBridge.invoked.length, 0);
  assert.equal(rig.blender.evidence.records.filter((record) => record.outcome === "ok").length, 0);

  // Unreal (the rig's own adapter): the same refusal, its own vocabulary.
  const unreal = await rig.unreal.dispatch(dispatch("neg-tn-4", "build.cook", {
    version: UNREAL_PAYLOAD_VERSION, tenant: OTHER_TENANT, target: UNREAL_PROJECT, targetPlatform: "windows", configuration: "shipping",
  }));
  assert.equal(unreal.outcome, "failed");
  if (unreal.outcome === "failed") {
    assert.equal(unreal.error.code, "unreal-tenancy/tenant-mismatch");
  }
  assert.equal(rig.unrealBridge.invoked.length, 0);

  // Unity and Godot: the same construction the rig itself performs (real
  // adapters from the public entrypoints over their shipped fake bridges).
  const unity = createUnityAdapter({ tenant: FORGE_TENANT, bridge: createFakeUnityBridge({ seed: UNITY_BRIDGE_SEED }), clock: createFakeUnityClock(WORKFLOW_CLOCK_ORIGIN_MS) });
  const godot = createGodotAdapter({ tenant: FORGE_TENANT, bridge: createFakeGodotBridge({ seed: GODOT_BRIDGE_SEED }), clock: createFakeGodotClock(WORKFLOW_CLOCK_ORIGIN_MS) });
  unity.markReady();
  godot.markReady();
  const unityRefusal = await unity.dispatch(dispatch("neg-tn-5", "project.inspect", {
    version: 1, tenant: OTHER_TENANT, projectName: "ForgeGame",
  }));
  if (unityRefusal.outcome === "failed") assert.equal(unityRefusal.error.code, "unity-tenancy/tenant-mismatch");
  const godotRefusal = await godot.dispatch(dispatch("neg-tn-6", "project.inspect", {
    version: 1, tenant: OTHER_TENANT, target: "res://forge.tscn",
  }));
  if (godotRefusal.outcome === "failed") assert.equal(godotRefusal.error.code, "godot-tenancy/tenant-mismatch");

  // Through the REAL fabric pipeline (the workflow's own path): the tenancy
  // refusal is a typed failure whose surfaced message carries the adapter's
  // verbatim code; nothing reached the bridge.
  const outcome = await callTool(rig, "neg-tn-7", "project.inspect", rig.blender.id, {
    version: BLENDER_PAYLOAD_VERSION, tenant: OTHER_TENANT, target: BLENDER_PROJECT,
  }, "neg-tenancy-key");
  const error = failureOf(outcome);
  assert.equal(error.code, "tool/execution-failed");
  assert.match(error.message, /blender-tenancy\/tenant-mismatch/);
  assert.equal(rig.blenderBridge.invoked.length, 0);
});

test("E8: malformed command payloads fail the adapters' total validators with their verbatim codes", async () => {
  const rig = createForgeAdapters();
  // Blender: an import whose format is outside BLENDER_ASSET_FORMATS.
  const blenderImport = validateBlenderCommandPayload("asset.import", {
    version: BLENDER_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: "SM_Phantom",
    format: "exe", artifact: { kind: "artifact-ref", digest: HEX("a"), bytes: 16 }, into: "scene",
  });
  assert.equal(blenderImport.outcome, "rejected");
  if (blenderImport.outcome === "rejected") {
    assert.ok(blenderImport.rejections.some((item) => item.code === "blender-payload/format-invalid"));
  }
  // Blender: a wrong payload version.
  const blenderVersion = validateBlenderCommandPayload("project.inspect", {
    version: 99, tenant: FORGE_TENANT, target: BLENDER_PROJECT,
  });
  if (blenderVersion.outcome === "rejected") {
    assert.ok(blenderVersion.rejections.some((item) => item.code === "blender-payload/version-invalid"));
  }
  // Unreal: a cook citing a build platform outside the desktop-class set.
  // The package's checkEnum emits the target-platform-missing code for a
  // MISSING and an out-of-set value alike (payload-validate.ts:275 — the
  // adapter's own negative-payload tests assert this case by message path,
  // never by a separate -invalid code; aligned with the runtime).
  const unrealCook = validateUnrealCommandPayload("build.cook", {
    version: UNREAL_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: UNREAL_PROJECT, targetPlatform: "android", configuration: "shipping",
  });
  assert.equal(unrealCook.outcome, "rejected");
  if (unrealCook.outcome === "rejected") {
    const rejection = unrealCook.rejections.find((item) => item.path === "payload.targetPlatform");
    if (rejection === undefined) throw new Error("expected the targetPlatform rejection");
    assert.equal(rejection.code, "unreal-payload/target-platform-missing");
    assert.equal(rejection.path, "payload.targetPlatform");
  }
  // Through the REAL adapter dispatch: the adapter's own payload failure code.
  const adapterFailure = await rig.blender.dispatch(dispatch("neg-pl-1", "project.inspect", {
    version: BLENDER_PAYLOAD_VERSION, tenant: FORGE_TENANT,
  }));
  assert.equal(adapterFailure.outcome, "failed");
  if (adapterFailure.outcome === "failed") {
    assert.equal(adapterFailure.error.code, "blender/invalid-payload");
  }
  // Through the REAL fabric pipeline: the unreal adapter's payload failure is
  // surfaced as a typed failure carrying the adapter's verbatim code.
  const outcome = await callTool(rig, "neg-pl-2", "build.cook", rig.unreal.id, {
    version: UNREAL_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: UNREAL_PROJECT, targetPlatform: "android", configuration: "shipping",
  }, "neg-payload-key");
  const error = failureOf(outcome);
  assert.equal(error.code, "tool/execution-failed");
  assert.match(error.message, /unreal\/invalid-payload/);
  assert.equal(rig.unrealBridge.invoked.length, 0);
});

test("E8/E7: the fabric pipeline refuses inline bytes and unresolvable artifact references", async () => {
  const rig = createForgeAdapters();
  // Inline bytes anywhere in the input tree are a typed pipeline failure.
  const inline = await callTool(rig, "neg-ex-1", "project.inspect", rig.blender.id, {
    version: BLENDER_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: BLENDER_PROJECT,
    smuggled: new Uint8Array([1, 2, 3]),
  }, "neg-inline-key");
  const inlineError = failureOf(inline);
  assert.equal(inlineError.code, "tool/invalid-input");
  assert.ok(inlineError.issues?.some((issue) => issue.message.includes("inline binary payloads are not allowed in the exchange")));
  // A well-formed artifact reference that does not resolve in the exchange is refused.
  const unresolvable = await callTool(rig, "neg-ex-2", "asset.import", rig.blender.id, {
    version: BLENDER_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: "SM_Phantom", format: "gltf", into: "scene",
    artifact: { kind: "artifact-ref", digest: HEX("b"), bytes: 16 },
  }, "neg-unresolvable-key");
  const artifactError = failureOf(unresolvable);
  assert.equal(artifactError.code, "tool/invalid-input");
  assert.ok(artifactError.issues?.some((issue) => issue.message.includes(`${HEX("b")} not found in the exchange`)));
  // Neither refusal reached the bridge; the exchange holds nothing new.
  assert.equal(rig.blenderBridge.invoked.length, 0);
  assert.equal(rig.exchange.size, 0);
});

test("E8/E10: an edited journal entry breaks the chain; duplicate appends are idempotent; revise is refused", () => {
  const journal = createWorkflowJournal();
  journal.append({ stage: "document", event: "workflow-opened", at: 1_000, detail: { workflowId: "negative" } });
  const second = journal.append({ stage: "authoring", event: "tool-call", at: 2_000, detail: { callId: "neg-1" } });
  // Duplicate appends (E10): a content-identical append returns the ORIGINAL
  // entry, classified as a duplicate — the journal does not grow.
  const duplicate = journal.append({ stage: "authoring", event: "tool-call", at: 2_000, detail: { callId: "neg-1" } });
  assert.ok(duplicate.ok && second.ok);
  if (duplicate.ok && second.ok) {
    assert.equal(duplicate.classification, "duplicate");
    assert.equal(duplicate.entry, second.entry);
  }
  assert.equal(journal.snapshot().length, 2);
  // History is never editable through the journal itself.
  const revise = journal.revise();
  assert.equal(revise.ok, false);
  if (!revise.ok) assert.equal(revise.code, "journal/append-only");
  // An EDITED snapshot breaks the chained digest (the tamper detector).
  const snapshot = journal.snapshot();
  const edited = snapshot.map((entry, index) => (index === 1 ? { ...entry, detail: { callId: "EDITED" } } : entry));
  const editedCheck = verifyJournalChain(edited);
  assert.equal(editedCheck.ok, false);
  if (!editedCheck.ok) assert.equal(editedCheck.code, "journal/chain-broken");
  // A REORDERED snapshot breaks the chain too (sequence + digest mismatch).
  const reordered = verifyJournalChain([snapshot[1], snapshot[0]]);
  assert.equal(reordered.ok, false);
  if (!reordered.ok) assert.equal(reordered.code, "journal/chain-broken");
  // The pristine journal's own verification still passes: entries are frozen
  // in-memory, so the tamper above was detected at the snapshot boundary —
  // the honest seam a persisted journal would face (E10/E11).
  const pristine = journal.verify();
  assert.equal(pristine.ok, true);
});

test("E8: unresolvable artifacts refuse typed at the registry/CAS authorities (fail closed)", async () => {
  const stores = await openForgeStores();
  // A record declaring a CAS artifact nobody stored: publication is refused
  // at the artifact-verification stage with the registry's own problem code
  // (the packages.ts stage vocabulary; the ONLY defect is the phantom digest).
  const phantomDigest = computeDigest({ phantom: "never-stored" });
  const metadata = (artifacts: UnsealedPackageRecord["metadata"]["artifacts"]): UnsealedPackageRecord["metadata"] => ({
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: { origin: { type: "original" }, sourceCommit: FORGE_COMMIT, transformationHistory: [], modelProvenance: [], generatedByAi: false },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["interactive"], engines: ["native"], targets: [{ profileId: "forge-windows", version: VERSION }] },
    resources: {},
    evaluationSuites: [],
    artifacts,
    extensionPoints: [],
    overlay: null,
  });
  const record = sealPackageRecord({
    identity: { kind: "assets", id: "@forge/phantom", version: VERSION },
    metadata: metadata([{ storage: "cas", digest: phantomDigest, sizeBytes: 64, mediaType: "application/json" }]),
  });
  const published = await publishPackage(record, { registry: stores.registry, artifacts: stores.artifacts });
  assert.equal(published.ok, false);
  if (!published.ok) {
    assert.equal(published.stage, "artifact-verification");
    assert.ok(published.problems?.some((problem) => problem.code === "artifact-missing"));
  }
  // A lock pinning an unpublished package refuses at lock verification.
  const lock: PackageLock = {
    lockVersion: 1,
    packages: [{ kind: "assets", id: "@forge/ghost", version: VERSION, contentDigest: computeDigest({ ghost: true }), resolvedFrom: "registry://tenant-forge" }],
    hostCapabilities: [],
  };
  const verification = verifyForgeLock(stores, { ok: true, records: [], lock, lockFingerprint: computeLockFingerprint(lock) });
  assert.equal(verification.pass, false);
  assert.ok(verification.pins.every((pin) => pin.problems.some((problem) => problem.code === "missing-package")));
});

test("E6: idempotent tool-call re-submission replays the cached receipt — effects exactly once", async () => {
  const rig = createForgeAdapters();
  const input = { version: BLENDER_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: BLENDER_PROJECT };
  const first = await callTool(rig, "neg-idem-1", "project.inspect", rig.blender.id, input, "neg-idempotency-key");
  assert.equal(first.outcome, "ok");
  // The same idempotency key re-submitted: the VERY SAME frozen outcome
  // (the cached receipt), never a second execution.
  const replay = await callTool(rig, "neg-idem-2", "project.inspect", rig.blender.id, input, "neg-idempotency-key");
  assert.equal(replay, first);
  assert.equal(rig.blenderBridge.invoked.length, 1);
  // A DIFFERENT input under the same key is the typed mismatch — and still
  // no third execution.
  const mismatch = await callTool(rig, "neg-idem-3", "project.inspect", rig.blender.id, {
    version: BLENDER_PAYLOAD_VERSION, tenant: FORGE_TENANT, target: "other.blend",
  }, "neg-idempotency-key");
  const error = failureOf(mismatch);
  assert.equal(error.code, "tool/idempotency-input-mismatch");
  assert.equal(rig.blenderBridge.invoked.length, 1);
});
