/**
 * FORGE — the workflow document (PL-038).
 *
 * The typed, content-addressed plan of the whole engine-native journey,
 * staged BEFORE anything executes (the native-game document idiom): the
 * asset requests the Blender adapter will author, the authoring command
 * sequence (capability + call id + payload fields, all pinned), the engine
 * target adjudication candidates (which engine binding meets which sealed
 * target profile), and the build request identity. The document digest
 * seals this plan — every later stage cites it, and two runs of the same
 * document must produce identical evidence (E9).
 *
 * Pure module: frozen data; no IO, no clocks, no randomness.
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest } from "../../../packages/package-system/src/index.ts";
import { BLENDER_PROJECT, BLENDER_SCENE, FORGE_GAME_ID, UNREAL_PROJECT, WORKFLOW_ID } from "./ids.ts";

/** One asset the authoring stage requests from the Blender tool adapter. */
export interface AssetRequest {
  /** Asset name (the import target inside the Blender project). */
  readonly name: string;
  /** The interchange format the source content is authored in. */
  readonly format: "gltf" | "fbx" | "obj";
  /** Where the import lands. */
  readonly into: "scene" | "library";
  /** Object edits applied to the imported asset (name + transform). */
  readonly edits: readonly { readonly property: string; readonly value: readonly number[] }[];
}

/** One Blender tool operation the workflow stages (capability-pinned). */
export interface AuthoringStep {
  /** The adapter capability dispatched ("project.inspect", "asset.import", ...). */
  readonly capability: string;
  /** Deterministic fabric call id (E9). */
  readonly callId: string;
  /** The idempotency key of the tool call (E6). */
  readonly idempotencyKey: string;
  /** The target field of the payload (project path / asset path). */
  readonly target: string;
}

/** One engine-binding × target-profile adjudication the workflow stages. */
export interface AdjudicationCandidate {
  /** The engine family whose binding adjudicates ("unreal" | "unity" | "godot"). */
  readonly engineId: string;
  /** The sealed target profile record id the binding is asked to serve. */
  readonly profileId: string;
}

/** The build request identity (idempotency material; E6/E9). */
export interface BuildIntention {
  readonly requester: string;
  readonly nonce: string;
  readonly requestedAt: number;
}

/** The typed workflow document. */
export interface EngineWorkflowDocument {
  readonly kind: "engine-workflow-document";
  readonly workflowId: string;
  readonly gameId: string;
  readonly assets: readonly AssetRequest[];
  readonly authoring: readonly AuthoringStep[];
  readonly adjudication: readonly AdjudicationCandidate[];
  readonly build: BuildIntention;
}

/** Deterministic source content bytes of one requested asset (E9: no IO). */
export function assetRequestBytes(request: AssetRequest): Uint8Array {
  return new TextEncoder().encode(
    `forge/asset/${request.name}: deterministic ${request.format} source bytes v1 (${request.edits.length} edit(s))`,
  );
}

/** The canonical workflow document (frozen; the single source of truth). */
export function forgeWorkflowDocument(): EngineWorkflowDocument {
  const assets: readonly AssetRequest[] = [
    {
      name: "SM_ForgePress",
      format: "gltf",
      into: "scene",
      edits: [
        { property: "location", value: [10, 4, 0] },
        { property: "scale", value: [2, 2, 2] },
      ],
    },
    {
      name: "SM_Anvil",
      format: "fbx",
      into: "library",
      edits: [{ property: "location", value: [14, 6, 0] }],
    },
  ];

  const authoring: readonly AuthoringStep[] = [
    { capability: "project.inspect", callId: "authoring-project-inspect", idempotencyKey: "authoring-project-inspect", target: BLENDER_PROJECT },
    ...assets.flatMap((asset): readonly AuthoringStep[] => [
      {
        capability: "asset.import",
        callId: `authoring-import-${asset.name}`,
        idempotencyKey: `authoring-import-${asset.name}`,
        target: asset.name,
      },
      {
        capability: "project.modify",
        callId: `authoring-modify-${asset.name}`,
        idempotencyKey: `authoring-modify-${asset.name}`,
        target: BLENDER_PROJECT,
      },
    ]),
    { capability: "scene.inspect", callId: "authoring-scene-inspect", idempotencyKey: "authoring-scene-inspect", target: BLENDER_SCENE },
    { capability: "editor.action", callId: "authoring-save-all", idempotencyKey: "authoring-save-all", target: BLENDER_PROJECT },
  ];

  const adjudication: readonly AdjudicationCandidate[] = [
    { engineId: "unreal", profileId: "forge-windows" },
    { engineId: "unity", profileId: "forge-web" },
    { engineId: "godot", profileId: "forge-web" },
    { engineId: "unreal", profileId: "forge-web" },
  ];

  return Object.freeze({
    kind: "engine-workflow-document",
    workflowId: WORKFLOW_ID,
    gameId: FORGE_GAME_ID,
    assets,
    authoring,
    adjudication,
    build: { requester: "forge-build-officer", nonce: "forge-canonical-build-1", requestedAt: 1_700_000_060_000 },
  });
}

/** The content digest sealing the document (E9: derived, never stored). */
export function workflowDocumentDigest(document: EngineWorkflowDocument): ContentDigest {
  return computeDigest({
    kind: document.kind,
    workflowId: document.workflowId,
    gameId: document.gameId,
    assets: document.assets,
    authoring: document.authoring,
    adjudication: document.adjudication,
    build: document.build,
  });
}

/** The Unreal project the build stage cooks (the workflow's build subject). */
export function unrealBuildProject(): string {
  return UNREAL_PROJECT;
}
