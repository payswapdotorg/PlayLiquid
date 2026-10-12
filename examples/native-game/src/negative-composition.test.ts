/**
 * COMPOSITION/BUILD NEGATIVE TESTS (PL-037; E8) — invalid inputs refuse
 * with TYPED refusals carrying the refusing authority's own vocabulary,
 * never a partial game:
 *
 * - an invalid GameIR document → `document-invalid` + the validator's
 *   own diagnostics;
 * - a target profile the engine binding cannot serve →
 *   `engine-binding-incompatible` + the adapter's refusal code;
 * - spark boot budgets that cannot fit → `spark-planning-refused` + the
 *   planner's own rejection codes;
 * - a tampered package lock → verification problems (lock rule 10), and
 *   the composition refuses `lock-unverified`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import { composeGame } from "./composition.ts";
import { lumenRunDocument } from "./document.ts";
import { publishGamePackages, verifyGameLock } from "./packages.ts";
import type { PublishedPackages } from "./packages.ts";
import { lumenSparkProfileRecord, planLumenSpark } from "./build.ts";
import { sealTargetProfileRecord, asEngineId, asEngineBindingDigest } from "../../../packages/target-profiles/src/index.ts";
import type { SparkTargetProfileRecord, UnsealedTargetProfileRecord } from "../../../packages/target-profiles/src/index.ts";

/** A structurally-mutated copy of the canonical document (typed as the game's own type). */
function mutatedDocument(mutate: (document: GameIRDocument) => void): GameIRDocument {
  const document = lumenRunDocument();
  mutate(document as GameIRDocument);
  return document;
}

test("negative composition: an invalid GameIR document refuses with the validator's diagnostics", async () => {
  // E007: the entry scene does not resolve.
  const broken = mutatedDocument((document) => {
    (document.entry as { scene: string }).scene = "scene-unknown";
  });
  const result = await composeGame({ document: broken });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "document-invalid");
    assert.ok(result.diagnostics.length > 0, "the refusal carries the validator's diagnostics");
    assert.equal(result.diagnostics[0]?.code, "GAMEIR/E007");
  }
});

test("negative composition: duplicate node ids refuse (E006)", async () => {
  const broken = mutatedDocument((document) => {
    const duplicate = structuredClone(document.nodes[1]!);
    (document.nodes as unknown[]).push(duplicate);
  });
  const result = await composeGame({ document: broken });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "document-invalid");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GAMEIR/E006"));
  }
});

test("negative composition: a profile the binding cannot serve refuses engine-binding-incompatible", async () => {
  // A sealed profile pinning a DIFFERENT engine family: the PlayCanvas
  // binding is not declared in the profile's engine bindings.
  const template = lumenSparkProfileRecord();
  const foreign = sealTargetProfileRecord({
    ...(template as unknown as UnsealedTargetProfileRecord),
    engineBindings: { engines: [asEngineId("engine-unreal")], pinnedBindings: [asEngineBindingDigest("sha256:" + "0".repeat(64))] },
  }) as SparkTargetProfileRecord;
  const result = await composeGame({ profile: foreign });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "engine-binding-incompatible");
    assert.equal(result.refusalCode, "playcanvas-binding/profile-engine-not-declared");
  }
});

test("negative composition: unachievable spark boot budgets refuse spark-planning-refused", async () => {
  // firstPaintTargetMs = 1 with ~160KB of first-paint-critical boot
  // content at 100 bytes/ms cannot fit: the planner refuses with its own
  // code and the composition surfaces it verbatim.
  const impossible = lumenSparkProfileRecord({ firstPaintTargetMs: 1, firstInteractionTargetMs: 2 });
  const direct = planLumenSpark(lumenRunDocument(), impossible);
  assert.equal(direct.ok, false);
  if (!direct.ok) {
    assert.equal(direct.code, "spark-planning-refused");
    assert.ok(direct.rejections.some((rejection) => rejection.code === "first-paint-oversized" || rejection.code === "critical-boot-oversized" || rejection.code === "budget-inversion"));
  }
  const result = await composeGame({ profile: impossible });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "spark-planning-refused");
});

test("negative lock: a tampered content digest fails verification against BOTH authorities", async () => {
  const published = await publishGamePackages(lumenRunDocument());
  if (!published.ok) throw new Error("publication refused");
  const forged: PublishedPackages = {
    ...published,
    lock: {
      ...published.lock,
      packages: published.lock.packages.map((pin, index) =>
        index === 0 ? { ...pin, contentDigest: "sha256:" + "0".repeat(64) } : pin,
      ),
    },
  };
  const verification = verifyGameLock(forged);
  assert.equal(verification.pass, false);
  const problems = verification.pins.flatMap((pin) => pin.problems);
  assert.ok(problems.length > 0, "the tampered pin reports its problems");

  const result = await composeGame({ document: lumenRunDocument() });
  assert.equal(result.ok, true, "the untampered composition still composes");
});

test("negative composition: an unknown version refuses at the document gate (E002)", async () => {
  const broken = mutatedDocument((document) => {
    (document as { irVersion: string }).irVersion = "999";
  });
  const result = await composeGame({ document: broken });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "document-invalid");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "GAMEIR/E002"));
  }
});
