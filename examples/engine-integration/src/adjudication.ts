/**
 * FORGE — the engine target adjudication stage (PL-038).
 *
 * The three REAL engine bindings (engine-unreal PL-022, engine-unity
 * PL-023, engine-godot PL-024) adjudicate the workflow's REAL sealed
 * target profile records (target-profiles' record taxonomy, R6/R12):
 * `unrealCanServeTargetProfile` / `unityCanServeTargetProfile` /
 * `godotCanServeTargetProfile` compose target-profiles' mutual-consent
 * compatibility check — the profile's engine declaration must accept the
 * engine AND the binding must declare the profile's target. Verdicts are
 * TYPED: { compatible: true } or the adapter's verbatim refusal code
 * (E8) — a target outside an engine's typed set is refused, never
 * coerced, never thrown.
 *
 * Every profile here is a complete sealed record (sealTargetProfileRecord
 * + validateTargetProfileRecord): the canonical build pins these exact
 * records by content digest.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asDigest, asTargetProfileId } from "../../../packages/runtime-contracts/src/index.ts";
import { computeDigest } from "../../../packages/package-system/src/index.ts";
import { sealTargetProfileRecord, validateTargetProfileRecord, asEngineBindingDigest, asEngineId } from "../../../packages/target-profiles/src/index.ts";
import type { PlainTargetProfileRecord, TargetProfileRecord, UnsealedTargetProfileRecord } from "../../../packages/target-profiles/src/index.ts";
import { createUnityEngineBinding, unityCanServeTargetProfile } from "../../../packages/engine-unity/src/index.ts";
import { createGodotEngineBinding, godotCanServeTargetProfile } from "../../../packages/engine-godot/src/index.ts";
import { createUnrealEngineBinding, unrealCanServeTargetProfile } from "../../../packages/engine-unreal/src/index.ts";
import type { UnrealEngineBinding, UnrealTargetCompatibility } from "../../../packages/engine-unreal/src/index.ts";
import type { UnityEngineBinding, UnityTargetCompatibility } from "../../../packages/engine-unity/src/index.ts";
import type { GodotEngineBinding, GodotTargetCompatibility } from "../../../packages/engine-godot/src/index.ts";

/** The three engine bindings (deterministic, content-addressed; E9). */
export interface EngineBindings {
  readonly unreal: UnrealEngineBinding;
  readonly unity: UnityEngineBinding;
  readonly godot: GodotEngineBinding;
}

/** Creates the three REAL engine bindings. */
export function forgeEngineBindings(): EngineBindings {
  return { unreal: createUnrealEngineBinding(), unity: createUnityEngineBinding(), godot: createGodotEngineBinding() };
}

/** One adjudication verdict (the adapter's own typed compatibility result). */
export type AdjudicationVerdict = UnrealTargetCompatibility | UnityTargetCompatibility | GodotTargetCompatibility;

/** One adjudicated candidate: the candidate + the binding's typed verdict. */
export interface AdjudicatedCandidate {
  readonly engineId: string;
  readonly profileId: string;
  readonly target: string;
  readonly verdict: AdjudicationVerdict;
}

/** The runtime-policy binding every forge profile declares (digest derived, E9). */
const FORGE_POLICY = {
  runtimes: ["interactive" as const, "simulation" as const],
  policy: {
    policyId: "forge-policy-default",
    revisionDigest: asDigest(computeDigest({ policy: "forge-policy-default", revision: 1 }).slice("sha256:".length)),
  },
} as const;

/** Seals one plain (non-spark, non-console) profile record over the declared engines. */
export function sealForgeProfile(
  profileId: string,
  target: PlainTargetProfileRecord["target"],
  engines: readonly string[],
  pinnedBindings: readonly string[] | null = null,
): PlainTargetProfileRecord {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId(profileId),
    target,
    version: "1.0.0",
    formFactor: "desktop-first",
    orientation: "landscape",
    aspectRatio: "16:9",
    capabilities: {
      render: "webgpu",
      vramClass: "medium",
      inputModalities: ["keyboard", "mouse"],
      screen: { touch: false, refreshHz: 60 },
    },
    runtimePolicy: FORGE_POLICY,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: pinnedBindings?.map((digest) => asEngineBindingDigest(digest)) ?? null },
    evaluationSuites: [],
    supersedes: null,
  };
  const record = sealTargetProfileRecord(unsealed) as PlainTargetProfileRecord;
  const validation = validateTargetProfileRecord(record);
  if (!validation.ok) {
    throw new Error(`forge profile ${profileId} is structurally invalid: ${validation.reasons.map((reason) => reason.code).join(", ")}`);
  }
  return record;
}

/** The workflow's sealed profile records, keyed by profile id. */
export interface ForgeProfiles {
  /** The desktop profile the canonical unreal build pins. */
  readonly windows: PlainTargetProfileRecord;
  /** The web profile unity/godot can serve (and unreal must refuse). */
  readonly web: PlainTargetProfileRecord;
  /** Record lookup by profile id. */
  readonly byId: ReadonlyMap<string, TargetProfileRecord>;
}

/** Creates the workflow's sealed target profile records (R6/R12). */
export function forgeProfiles(): ForgeProfiles {
  const windows = sealForgeProfile("forge-windows", "windows", ["unreal", "native"]);
  const web = sealForgeProfile("forge-web", "web", ["unity", "godot", "native", "playcanvas"]);
  return { windows, web, byId: new Map([["forge-windows", windows], ["forge-web", web]]) };
}

/** Runs the binding of `engineId` over `profile` (typed verdict, never a throw). */
function adjudicate(bindings: EngineBindings, engineId: string, profile: TargetProfileRecord): AdjudicationVerdict {
  if (engineId === "unreal") {
    return unrealCanServeTargetProfile(bindings.unreal, profile);
  }
  if (engineId === "unity") {
    return unityCanServeTargetProfile(bindings.unity, profile);
  }
  return godotCanServeTargetProfile(bindings.godot, profile);
}

/**
 * Adjudicates every staged candidate: each engine binding meets each cited
 * profile record and returns its TYPED verdict — compatibility or the
 * adapter's verbatim refusal code (E8). Deterministic (E9).
 */
export function runAdjudicationStage(
  bindings: EngineBindings,
  profiles: ForgeProfiles,
  candidates: readonly { readonly engineId: string; readonly profileId: string }[],
): AdjudicatedCandidate[] {
  const adjudicated: AdjudicatedCandidate[] = [];
  for (const candidate of candidates) {
    const profile = profiles.byId.get(candidate.profileId);
    if (profile === undefined) {
      throw new Error(`adjudication candidate cites unknown profile ${candidate.profileId}`);
    }
    adjudicated.push({
      engineId: candidate.engineId,
      profileId: candidate.profileId,
      target: String(profile.target),
      verdict: adjudicate(bindings, candidate.engineId, profile),
    });
  }
  return adjudicated;
}
