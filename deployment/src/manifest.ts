/**
 * THE DEPLOYMENT MANIFEST (PL-044) — the committed verified-plan evidence.
 *
 * `deployment/manifests/deployment-plan.json` is generated
 * DETERMINISTICALLY from the corpus (corpus.ts) by
 * {@link generateDeploymentManifestJson}: the honest-topology plan is
 * verified through the REAL doors at the FIXED instant
 * {@link DEPLOYMENT_MANIFEST_INSTANT} under the injected clock, and the
 * verified seal plus the plan are committed as canonical JSON. Because
 * generation is a pure function of the corpus (E9), regenerating must
 * reproduce the committed file byte-for-byte — asserted by
 * manifest.test.ts — and the committed seal must re-verify against the
 * committed plan (seal forgery is a typed `seal-mismatch` refusal).
 *
 * E11 HONESTY: the manifest carries the all-false environment truth
 * structurally; a manifest claiming real infrastructure, network,
 * containers or secrets management cannot verify (`honesty-violation`).
 */

import { canonicalJson } from "../../packages/package-system/src/index.ts";
import type { DeploymentDoors } from "./ports.ts";
import type { DeploymentRefusalCode } from "./ports.ts";
import { isDeploymentPlan, DEPLOYMENT_TRUTH } from "./model.ts";
import type { DeploymentPlan } from "./model.ts";
import { verifyDeploymentPlan, verifyDeploymentSeal } from "./verifier.ts";
import type { DeploymentSeal } from "./ports.ts";
import { createCorpusDoors, honestTopologyPlan } from "./corpus.ts";
import { createFixedClock } from "../../services/ops/src/index.ts";

/** The manifest document's format version (frozen). */
export const DEPLOYMENT_MANIFEST_VERSION = 1;

/**
 * The fixed verification instant of the committed manifest (the injected
 * clock reading at generation; documented, deterministic — E9). A real
 * deployment tool would stamp the actual instant; the committed evidence
 * pins its own so regeneration reproduces the seal.
 */
export const DEPLOYMENT_MANIFEST_INSTANT = 1_700_000_000_000;

/** The manifest generator identity recorded in the document. */
export const DEPLOYMENT_MANIFEST_GENERATOR = "deployment/src/manifest.ts (deterministic corpus evidence, E9)";

/** THE manifest document: truth + plan + seal, committed as evidence. */
export interface DeploymentManifest {
  readonly manifestVersion: typeof DEPLOYMENT_MANIFEST_VERSION;
  readonly generatedBy: string;
  readonly truth: typeof DEPLOYMENT_TRUTH;
  readonly plan: DeploymentPlan;
  readonly seal: DeploymentSeal;
}

/**
 * Generates the manifest document JSON (canonical, newline-terminated).
 * Total and honest: generation REFUSES (returns the typed refusal) when
 * the plan does not verify — only verified plans become manifest
 * evidence.
 */
export function generateDeploymentManifest(options?: {
  readonly doors?: DeploymentDoors;
  readonly instant?: number;
}): { readonly ok: true; readonly manifest: DeploymentManifest; readonly json: string } | { readonly ok: false; readonly code: DeploymentRefusalCode; readonly detail: string } {
  const doors = options?.doors ?? createCorpusDoors();
  const instant = options?.instant ?? DEPLOYMENT_MANIFEST_INSTANT;
  const plan = honestTopologyPlan();
  const verification = verifyDeploymentPlan(plan, { doors, clock: createFixedClock(instant) });
  if (!verification.ok) {
    return { ok: false, code: verification.code, detail: `the honest-topology plan does not verify, so no manifest may be generated: ${verification.detail}` };
  }
  const manifest: DeploymentManifest = {
    manifestVersion: DEPLOYMENT_MANIFEST_VERSION,
    generatedBy: DEPLOYMENT_MANIFEST_GENERATOR,
    truth: DEPLOYMENT_TRUTH,
    plan,
    seal: verification.seal,
  };
  return { ok: true, manifest, json: `${canonicalJson(manifest)}\n` };
}

/** Convenience alias: just the canonical JSON text. */
export function generateDeploymentManifestJson(): string {
  const generated = generateDeploymentManifest();
  if (!generated.ok) throw new Error(`manifest generation refused: ${generated.detail}`);
  return generated.json;
}

/** Result of parsing a committed manifest (untrusted input, fail-closed). */
export type DeploymentManifestParse =
  | { readonly ok: true; readonly manifest: DeploymentManifest }
  | { readonly ok: false; readonly code: "invalid-manifest" | "honesty-violation"; readonly detail: string };

/** Parses untrusted manifest JSON (structure + honesty, fail-closed). */
export function parseDeploymentManifest(json: string): DeploymentManifestParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, code: "invalid-manifest", detail: `the manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, code: "invalid-manifest", detail: "the manifest is an object" };
  }
  const candidate = parsed as Partial<DeploymentManifest>;
  if (candidate.manifestVersion !== DEPLOYMENT_MANIFEST_VERSION) {
    return { ok: false, code: "invalid-manifest", detail: `manifest version ${String(candidate.manifestVersion)} is not ${String(DEPLOYMENT_MANIFEST_VERSION)}` };
  }
  if (typeof candidate.generatedBy !== "string" || candidate.generatedBy.length === 0) {
    return { ok: false, code: "invalid-manifest", detail: "the manifest names its generator" };
  }
  const truth = candidate.truth;
  if (truth === undefined || truth.realInfrastructure !== false || truth.network !== false || truth.containers !== false || truth.secretsManagement !== false) {
    return { ok: false, code: "honesty-violation", detail: "the manifest may not claim real infrastructure, network, containers or secrets management — the evidence is a typed model verified in-process (E11)" };
  }
  if (!isDeploymentPlan(candidate.plan)) {
    return { ok: false, code: "invalid-manifest", detail: "the manifest carries a structurally valid deployment plan" };
  }
  const seal = candidate.seal;
  if (typeof seal !== "object" || seal === null || typeof seal.sealDigest !== "string" || typeof seal.planDigest !== "string" || typeof seal.verifiedAt !== "number" || typeof seal.units !== "number" || typeof seal.verifier !== "string") {
    return { ok: false, code: "invalid-manifest", detail: "the manifest carries a well-formed seal" };
  }
  return { ok: true, manifest: { manifestVersion: DEPLOYMENT_MANIFEST_VERSION, generatedBy: candidate.generatedBy, truth: DEPLOYMENT_TRUTH, plan: candidate.plan, seal } };
}

/** The manifest re-verification result (typed; total). */
export type DeploymentManifestVerification =
  | { readonly ok: true; readonly seal: DeploymentSeal }
  | { readonly ok: false; readonly code: DeploymentRefusalCode; readonly detail: string };

/**
 * Re-verifies a COMMITTED manifest against live doors (the
 * `manifest.test.ts` evidence door):
 * 1. parse (structure + the all-false honesty truth, E11);
 * 2. re-run the FULL plan verification through the doors (the plan is
 *    re-verified against the authorities, not trusted from the file);
 * 3. re-derive the committed seal — it must cover THIS plan's content
 *    and recompute at its own recorded instant (E9/E8: seal forgery,
 *    plan transplants and post-seal plan edits all refuse).
 */
export function verifyDeploymentManifest(
  json: string,
  doors: DeploymentDoors,
  options?: { readonly clock?: { now(): number } },
): DeploymentManifestVerification {
  const parsed = parseDeploymentManifest(json);
  if (!parsed.ok) return { ok: false, code: parsed.code, detail: parsed.detail };
  const { plan, seal } = parsed.manifest;
  const verification = verifyDeploymentPlan(plan, { doors, clock: options?.clock ?? { now: () => 0 } });
  if (!verification.ok) {
    return { ok: false, code: verification.code, detail: `the committed plan no longer verifies through the doors: ${verification.detail}` };
  }
  const committed = verifyDeploymentSeal(seal, plan);
  if (!committed.ok) {
    return { ok: false, code: committed.code, detail: `the committed seal does not verify: ${committed.detail}` };
  }
  return { ok: true, seal };
}
