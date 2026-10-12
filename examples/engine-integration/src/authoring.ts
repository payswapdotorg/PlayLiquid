/**
 * FORGE — the asset authoring stage (PL-038).
 *
 * The first stage of the engine-native workflow: the requested assets are
 * authored through the REAL Blender tool adapter over the REAL Tool Fabric
 * runtime — every call flows through the pipeline (envelope validation →
 * idempotency ledger → capability mediation → shape seam → the
 * content-addressed exchange guard → the adapter-dispatch executor → the
 * adapter's total payload validation → tenancy → the fake bridge). The
 * import payloads carry artifact references to source bytes actually
 * stored in the fabric's content-addressed exchange (E7): inline bytes are
 * refused by the pipeline, unresolvable references are refused by the
 * pipeline, and both refusals are exercised in the negative battery.
 *
 * Every authoritative result is journaled (E10) with its content digest;
 * the sealed per-asset receipt bytes handed to the registry stage are the
 * canonical JSON of the adapter's own authoritative outputs.
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest } from "../../../packages/package-system/src/index.ts";
import { BLENDER_PAYLOAD_VERSION } from "../../../packages/tool-blender/src/index.ts";
import type { ToolCallOutcome } from "../../../packages/tool-fabric/src/index.ts";
import { BLENDER_PROJECT, FORGE_TENANT, TOOL_SURFACE } from "./ids.ts";
import { capabilityTool, type ForgeAdapters, type WorkflowClock } from "./rig.ts";
import type { EngineWorkflowDocument } from "./document.ts";
import { assetRequestBytes } from "./document.ts";
import type { JournalAppendResult, WorkflowJournal } from "./journal.ts";

/** A typed authoring-stage refusal (E8: every failure is named, never swallowed). */
export interface AuthoringRefusal {
  readonly ok: false;
  readonly code: "authoring/tool-refused";
  readonly message: string;
}

/** One tool call receipt: the authoritative outcome the journal seals. */
export interface ToolCallReceipt {
  readonly callId: string;
  readonly capability: string;
  readonly tool: string;
  readonly outcome: "ok" | "failure";
  readonly outputDigest: ContentDigest;
  readonly output: unknown;
}

/** One sealed asset: the canonical receipt bytes + their content digest. */
export interface SealedAsset {
  readonly name: string;
  readonly digest: ContentDigest;
  readonly bytes: Uint8Array;
  /** The exchange reference the import consumed (E7 provenance). */
  readonly sourceRef: { readonly digest: string; readonly bytes: number };
}

/** The authoring stage outcome. */
export interface AuthoringOutcome {
  readonly ok: true;
  readonly receipts: readonly ToolCallReceipt[];
  readonly sealed: readonly SealedAsset[];
}

/** Describes a non-ok fabric outcome in the refusal message (typed union, no casts). */
function describeFabricRefusal(outcome: Exclude<ToolCallOutcome, { readonly outcome: "ok" }>): string {
  if (outcome.outcome === "failure") {
    return `${outcome.error.code}: ${outcome.error.message}`;
  }
  if (outcome.outcome === "timeout") {
    return `tool-call/timeout: the deadline ${String(outcome.deadline.atEpochMs)} passed`;
  }
  return `tool-call/cancelled: ${String(outcome.cancellation.reason)}`;
}

/** Drives ONE tool call through the real pipeline and returns its receipt. */
async function invokeTool(
  rig: ForgeAdapters,
  step: { readonly callId: string; readonly capability: string; readonly idempotencyKey: string },
  input: Record<string, unknown>,
): Promise<{ readonly ok: true; readonly receipt: ToolCallReceipt } | AuthoringRefusal> {
  const tool = capabilityTool(step.capability, rig.blender.id);
  const outcome: ToolCallOutcome = await rig.runtime.invokeToolCall({
    kind: "tool-call-request",
    callId: step.callId,
    tool,
    surfaceVersion: { ...TOOL_SURFACE },
    input: { ...input, tenant: FORGE_TENANT },
    requiredCapabilities: [],
    idempotencyKey: step.idempotencyKey,
  });
  if (outcome.outcome !== "ok") {
    return {
      ok: false,
      code: "authoring/tool-refused",
      message: `${step.capability} (${step.callId}) refused by the fabric: ${describeFabricRefusal(outcome)}`,
    };
  }
  const output = outcome.output ?? null;
  return {
    ok: true,
    receipt: {
      callId: step.callId,
      capability: step.capability,
      tool: `${tool.namespace}/${tool.name}`,
      outcome: "ok",
      outputDigest: computeDigest(output),
      output,
    },
  };
}

/** Journals one tool-call receipt (E10; duplicate appends are idempotent). */
function journalReceipt(journal: WorkflowJournal, receipt: ToolCallReceipt, at: number): JournalAppendResult {
  return journal.append({
    stage: "authoring",
    event: "tool-call",
    at,
    detail: {
      callId: receipt.callId,
      capability: receipt.capability,
      tool: receipt.tool,
      outcome: receipt.outcome,
      outputDigest: receipt.outputDigest,
    },
  });
}

/** The canonical receipt bytes sealing one asset's authoritative outputs. */
function receiptBytes(entries: readonly ToolCallReceipt[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(entries.map((receipt) => ({ capability: receipt.capability, output: receipt.output }))),
  );
}

/**
 * Runs the authoring stage: source bytes into the exchange, then the
 * document's staged Blender operations through the fabric, then the sealed
 * per-asset receipts. Deterministic (E9): same document + fresh rig ⇒
 * identical receipts, digests and journal entries.
 */
export async function runAuthoringStage(
  rig: ForgeAdapters,
  document: EngineWorkflowDocument,
  journal: WorkflowJournal,
  clock: WorkflowClock,
): Promise<AuthoringOutcome | AuthoringRefusal> {
  const receipts: ToolCallReceipt[] = [];
  const sealed: SealedAsset[] = [];

  // 1. Source bytes into the content-addressed exchange (E7).
  const sourceRefs = new Map<string, { readonly digest: string; readonly bytes: number }>();
  for (const request of document.assets) {
    const ref = rig.exchange.put(assetRequestBytes(request));
    sourceRefs.set(request.name, ref);
  }

  // 2. The staged Blender operations, in document order.
  const assetsByName = new Map(document.assets.map((request) => [request.name, request]));
  for (const step of document.authoring) {
    const input: Record<string, unknown> = { version: BLENDER_PAYLOAD_VERSION };
    if (step.capability === "project.inspect" || step.capability === "scene.inspect") {
      input["target"] = step.target;
    } else if (step.capability === "asset.import") {
      const request = assetsByName.get(step.target);
      const ref = sourceRefs.get(step.target);
      if (request === undefined || ref === undefined) {
        return { ok: false, code: "authoring/tool-refused", message: `authoring step ${step.callId} cites an unstaged asset ${step.target}` };
      }
      input["target"] = step.target;
      input["format"] = request.format;
      input["artifact"] = { kind: "artifact-ref", digest: ref.digest, bytes: ref.bytes };
      input["into"] = request.into;
    } else if (step.capability === "project.modify") {
      const request = document.assets.find((candidate) => step.callId === `authoring-modify-${candidate.name}`);
      if (request === undefined) {
        return { ok: false, code: "authoring/tool-refused", message: `authoring step ${step.callId} has no asset to modify` };
      }
      input["target"] = BLENDER_PROJECT;
      input["edits"] = request.edits.map((edit) => ({ objectName: request.name, property: edit.property, value: edit.value }));
    } else if (step.capability === "editor.action") {
      input["target"] = step.target;
      input["action"] = "save-all";
    } else {
      return { ok: false, code: "authoring/tool-refused", message: `the document stages unsupported capability ${step.capability}` };
    }
    const result = await invokeTool(rig, step, input);
    if (!result.ok) {
      return result;
    }
    receipts.push(result.receipt);
    journalReceipt(journal, result.receipt, clock.now());
    clock.advanceBy(1_000);
  }

  // 3. Seal one artifact per asset from its authoritative outputs (E9 digests).
  for (const request of document.assets) {
    const assetReceipts = receipts.filter((receipt) => receipt.callId === `authoring-import-${request.name}` || receipt.callId === `authoring-modify-${request.name}`);
    // computeDigest canonicalizes PLAIN values only — digest the same
    // projection receiptBytes encodes, never the Uint8Array itself.
    const assetProjection = assetReceipts.map((receipt) => ({ capability: receipt.capability, output: receipt.output }));
    const bytes = receiptBytes(assetReceipts);
    const ref = sourceRefs.get(request.name);
    if (ref === undefined) {
      return { ok: false, code: "authoring/tool-refused", message: `asset ${request.name} lost its exchange reference` };
    }
    sealed.push({ name: request.name, digest: computeDigest(assetProjection), bytes, sourceRef: ref });
  }
  return { ok: true, receipts, sealed };
}
