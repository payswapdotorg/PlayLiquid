/**
 * LATTICE — the versioned world composition (PL-039; §Game model).
 *
 * "Game = versioned composition of packages + target profile + runtime
 * policy." The large world composes as: a validated GameIR document (the
 * static definition), the derived world model (the spatial hierarchy +
 * streaming contracts), the published package graph (87 packages through
 * the registry/CAS authorities) and the verified lock. Every step that
 * fails is a TYPED refusal — never a partial world.
 *
 * Determinism (E9): all digests are content-derived; composing twice
 * yields byte-identical packages, locks and fingerprints.
 */

import { validate, canonicalValueForm } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import { canonicalJson, computeDigest, computeLockFingerprint } from "../../../packages/package-system/src/index.ts";
import { latticeDocument } from "./document.ts";
import { deriveWorldModel } from "./world-model.ts";
import type { LatticeWorldModel } from "./world-model.ts";
import { LATTICE_PACKAGE_COUNT, publishLatticeWorld, verifyLatticeLock } from "./packages.ts";
import type { LatticeWorldGraph, PublicationRefusal } from "./packages.ts";
import { bareDigest } from "./ids.ts";

/** The digest-pinned game reference the simulation binding carries. */
export interface LatticeGameRef {
  readonly gameDigest: string;
  readonly worldId: string;
  readonly worldRevisionDigest: string;
  readonly policyId: string;
  readonly policyRevisionDigest: string;
}

/** The sealed, digest-pinned world composition. */
export interface LatticeComposition {
  readonly ok: true;
  readonly document: GameIRDocument;
  readonly model: LatticeWorldModel;
  readonly graph: LatticeWorldGraph;
  readonly game: LatticeGameRef;
  /** The GameIR document content digest (sha256:<hex>). */
  readonly gameIrDigest: string;
  /** The package lock fingerprint (sha256:<hex>). */
  readonly lockFingerprint: string;
  /** Content digest sealing the whole composition. */
  readonly compositionDigest: string;
  readonly packageCount: number;
  readonly chunkCount: number;
}

/** Why a composition was refused (typed; E8 totality). */
export type CompositionRefusal =
  | { readonly ok: false; readonly code: "document-invalid"; readonly diagnostics: readonly { readonly code: string; readonly message: string }[] }
  | { readonly ok: false; readonly code: "world-model-invalid"; readonly detail: string }
  | (PublicationRefusal & { readonly code?: undefined })
  | { readonly ok: false; readonly code: "lock-unverified"; readonly problems: readonly { readonly code: string; readonly message: string }[] };

/** The document's canonical CAS bytes (the world package's content artifact). */
export function documentArtifactBytes(document: GameIRDocument): Uint8Array {
  const nodes = document.nodes.map((node): unknown =>
    node.kind === "entity" ? { ...node, state: canonicalValueForm(node.state) } : node,
  );
  return new TextEncoder().encode(canonicalJson({ irVersion: document.irVersion, identity: document.identity, lifecycle: document.lifecycle ?? "active", entry: document.entry, nodes }));
}

/**
 * The digest-pinned game reference: the full-document digest, the entry
 * world's revision digest (world node) and the runtime-policy digest
 * (capability-declaration nodes — the replay declaration, R8).
 */
export function latticeGameRef(document: GameIRDocument): LatticeGameRef {
  const worldNode = document.nodes.find((node) => node.kind === "world" && node.world === document.entry.world);
  if (worldNode === undefined) {
    throw new Error(`lattice: entry world ${String(document.entry.world)} has no world node`);
  }
  const policyNodes = document.nodes.filter((node) => node.kind === "capability-declaration");
  return {
    gameDigest: bareDigest(computeDigest({ irVersion: document.irVersion, identity: document.identity, entry: document.entry, nodes: document.nodes.length }))!,
    worldId: String(document.entry.world),
    worldRevisionDigest: bareDigest(computeDigest(worldNode))!,
    policyId: "lattice-streaming-policy",
    policyRevisionDigest: bareDigest(computeDigest(policyNodes))!,
  };
}

/**
 * Composes the large world. Total: either the sealed composition or a
 * typed refusal carrying the refusing gate's own vocabulary. The optional
 * `document` override exists ONLY for the negative tests (E8: invalid
 * compositions refuse through the same gates — never a partial world);
 * the canonical path always composes {@link latticeDocument}.
 */
export async function composeLatticeWorld(options: { readonly document?: GameIRDocument } = {}): Promise<LatticeComposition | CompositionRefusal> {
  const document = options.document ?? latticeDocument();
  const validation = validate(document);
  if (!validation.ok) {
    return {
      ok: false,
      code: "document-invalid",
      diagnostics: validation.diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message })),
    };
  }
  let model: LatticeWorldModel;
  try {
    model = deriveWorldModel(document);
  } catch (error) {
    return { ok: false, code: "world-model-invalid", detail: error instanceof Error ? error.message : String(error) };
  }
  const graph = await publishLatticeWorld(model, documentArtifactBytes(document));
  if (!graph.ok) {
    return { ok: false, stage: graph.stage, packageId: graph.packageId, detail: graph.detail };
  }
  const lockVerification = verifyLatticeLock(graph);
  if (!lockVerification.pass) {
    return {
      ok: false,
      code: "lock-unverified",
      problems: lockVerification.pins.flatMap((pin) => pin.problems.map((problem) => ({ code: problem.code, message: problem.message }))),
    };
  }
  const gameIrDigest = computeDigest({ identity: document.identity, entry: document.entry, nodes: document.nodes.map((node) => node.id) });
  const lockFingerprint = computeLockFingerprint(graph.lock);
  return {
    ok: true as const,
    document,
    model,
    graph,
    game: latticeGameRef(document),
    gameIrDigest,
    lockFingerprint,
    compositionDigest: computeDigest({ world: "lattice", gameIrDigest, lockFingerprint }),
    packageCount: LATTICE_PACKAGE_COUNT,
    chunkCount: model.chunkCount,
  };
}
