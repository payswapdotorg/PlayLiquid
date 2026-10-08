/**
 * Shared fixtures and IN-MEMORY FAKES for tests and the selfcheck harness.
 *
 * The Lab contracts define ports (`EvaluationSuiteResolver`,
 * `OrganizationEvaluator`); the real implementations arrive in PL-028/
 * PL-029. The fakes here are deterministic, in-memory, PURE test doubles —
 * they prove the ports are implementable and consumable, and they are the
 * only "simulation" this package will ever contain (lock rule 29: their
 * output is a labeled estimate, never ground truth).
 *
 * Fragment-discipline: every digest below is
 * fragment-assembled from short character runs and `.repeat()` — no
 * 64-char hex literals appear anywhere in this package.
 *
 * Not exported from the package barrel: fixtures are test/harness
 * infrastructure, not public contract surface (house pattern of
 * game-ir/src/fixtures.ts).
 */

import {
  asAgentId,
  asAvatarId,
  asCommitSha,
  asEntityId,
  asGameId,
  asSceneId,
  asWorldId,
} from "@playliquid/game-contracts";
import type { GameIdentity } from "@playliquid/game-contracts";
import type { GameIRValue, ValueShape } from "@playliquid/game-ir";
import type { ContentDigest } from "./primitives.ts";
import { asContentDigest } from "./primitives.ts";
import type {
  CandidateEvaluationId,
  EvaluationSeed,
  LabCycleId,
  OrganizationId,
  TimestampMs,
} from "./primitives.ts";
import {
  asCandidateEvaluationId,
  asEvaluationSeed,
  asLabCycleId,
  asLabEvaluationMetricId,
  asLabEvaluationSuiteId,
  asOrganizationId,
  asTimestampMs,
} from "./primitives.ts";
import type { LabeledEstimate, SimulatorOutput } from "./estimates.ts";
import type {
  EvaluationMetricReading,
  EvaluationSuiteResolver,
  LabEvaluationSuite,
  LabEvaluationSuiteRef,
} from "./evaluation-suites.ts";
import type { OrganizationEvaluator, OrganizationEvaluationRequest } from "./evaluation.ts";
import type { OrganizationDescriptor } from "./organization.ts";
import { generalistBaselineOrganization } from "./organization.ts";
import type { ZCodeModelAssignmentRef } from "./seams.ts";
import { asZCodeModelRouteId } from "./seams.ts";

const HEX_DIGITS = "0123456789abcdef";

/**
 * Deterministic 64-hex content digest assembled from character codes —
 * pure, dependency-free and never a literal (fragment-discipline rule).
 */
export function fixtureDigest(text: string): ContentDigest {
  let out = "";
  for (let index = 0; index < 64; index += 1) {
    const code = text.charCodeAt(index % text.length) + index * 31;
    out += HEX_DIGITS[code % 16];
  }
  return asContentDigest(out)!;
}

/** Deterministic caller-supplied timestamp for fixtures. */
export function fixtureTimestamp(ms = 1_000): TimestampMs {
  return asTimestampMs(ms)!;
}

/** A canonical ZCode seam model-assignment reference for fixtures. */
export function fixtureModelRoute(route = "route-default"): ZCodeModelAssignmentRef {
  return { authority: "zcode-model-routing", route: asZCodeModelRouteId(route)! };
}

/** A canonical Git commit ref (fragment-assembled sha). */
export function fixtureCommitRef(text = "fixture-commit") {
  const sha = asCommitSha(["a1", "b2"].join("") + fixtureDigest(text).slice(0, 36))!;
  return { kind: "commit", commit: sha } as const;
}

/** A structurally valid game identity for fixtures. */
export function fixtureGameIdentity(): GameIdentity {
  const sha = asCommitSha(["c3", "d4"].join("") + fixtureDigest("identity").slice(0, 36))!;
  return {
    id: asGameId("game-lab-fixture")!,
    displayName: "Lab Fixture Game",
    kind: "game",
    repository: { host: "github.com", owner: "payswapdotorg", repository: "game-lab-fixture" },
    revision: { kind: "commit", commit: sha },
    lineage: { head: sha, ancestors: [] },
  };
}

/** A canonical generalist baseline organization for fixtures. */
export function fixtureGeneralistOrganization(
  organizationText = "org-generalist-baseline",
  agentText = "agent-lab",
): { readonly descriptor: OrganizationDescriptor; readonly id: OrganizationId } {
  const id = asOrganizationId(organizationText)!;
  return {
    id,
    descriptor: generalistBaselineOrganization({
      organizationId: id,
      agent: asAgentId(agentText)!,
      model: fixtureModelRoute(),
    }),
  };
}

/** A canonical evaluation-suite reference for fixtures. */
export function fixtureSuiteRef(suiteText = "suite-lab-core"): LabEvaluationSuiteRef {
  return {
    suiteId: asLabEvaluationSuiteId(suiteText)!,
    irVersion: "1",
    contentDigest: fixtureDigest(suiteText),
  };
}

/** A resolved suite with scalar kernel-shaped metrics for fixtures. */
export function fixtureSuite(): LabEvaluationSuite {
  return {
    ref: fixtureSuiteRef(),
    summary: "Lab fixture suite: throughput and defect density",
    metrics: [
      { metricId: asLabEvaluationMetricId("metric-throughput")!, summary: "Tasks completed per day", shape: { kind: "float" } },
      { metricId: asLabEvaluationMetricId("metric-defects")!, summary: "Defects per release", shape: { kind: "int" } },
    ],
  };
}

/** Builds a kernel value matching `shape` (fake reading generation). */
export function fakeValueForShape(shape: ValueShape): GameIRValue {
  switch (shape.kind) {
    case "unit":
      return { kind: "unit" };
    case "bool":
      return { kind: "bool", value: true };
    case "int":
      return { kind: "int", value: 3n };
    case "float":
      return { kind: "float", value: 0.75 };
    case "string":
      return { kind: "string", value: "fixture" };
    case "list":
      return { kind: "list", items: [] };
    case "record": {
      const fields: Record<string, GameIRValue> = {};
      for (const key of Object.keys(shape.fields)) {
        const fieldShape = shape.fields[key];
        if (fieldShape !== undefined) fields[key] = fakeValueForShape(fieldShape);
      }
      return { kind: "record", fields };
    }
    case "entity-ref":
      return {
        kind: "entity-ref",
        ref: {
          world: asWorldId("world-fixture")!,
          scene: asSceneId("scene-fixture")!,
          entity: asEntityId("entity-fixture")!,
        },
      };
  }
}

/**
 * IN-MEMORY FAKE of the suite-resolver port: resolves only the suites it
 * was constructed with, by suiteId + digest pin.
 */
export function fakeSuiteResolver(suites: readonly LabEvaluationSuite[]): EvaluationSuiteResolver {
  return (ref) =>
    suites.find((suite) => suite.ref.suiteId === ref.suiteId && suite.ref.contentDigest === ref.contentDigest);
}

/**
 * IN-MEMORY FAKE of the organization-evaluator port: a deterministic
 * "simulator" that produces one shape-matching reading per suite metric.
 * Its output is an explicitly-labeled estimate (E11) — even fakes are not
 * allowed to pretend to be observations (lock rule 29).
 */
export function fakeOrganizationEvaluator(): OrganizationEvaluator {
  return (request: OrganizationEvaluationRequest): LabeledEstimate<readonly EvaluationMetricReading[]> => {
    const payload: EvaluationMetricReading[] = request.suite.metrics.map((metric) => ({
      metricId: metric.metricId,
      value: fakeValueForShape(metric.shape),
    }));
    const output: SimulatorOutput<readonly EvaluationMetricReading[]> = {
      epistemic: "labeled-estimate",
      method: "simulation",
      simulator: "lab-fake-simulator",
      payload,
    };
    return output;
  };
}

/** A canonical cycle id for fixtures. */
export function fixtureCycleId(text = "cycle-1"): LabCycleId {
  return asLabCycleId(text)!;
}

/** A canonical candidate-evaluation id for fixtures. */
export function fixtureEvaluationId(text = "evaluation-1"): CandidateEvaluationId {
  return asCandidateEvaluationId(text)!;
}

/** A canonical reproducibility seed for fixtures (E9). */
export function fixtureSeed(text = "seed-1"): EvaluationSeed {
  return asEvaluationSeed(text)!;
}

/** An avatar id for cross-package fixture reuse checks. */
export const FIXTURE_AVATAR = asAvatarId("avatar-lab-fixture")!;
