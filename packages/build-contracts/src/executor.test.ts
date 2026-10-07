/**
 * The BuildExecutor port contract: deterministic fakes, fail-closed
 * console behavior, and port shape (ports, not engines).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildExecutor } from "./executor.ts";
import { computeBuildManifestDigest } from "./outputs.ts";
import { validateBuildOutputs } from "./validate.ts";
import {
  fakeBuildExecutor,
  fixtureAdmittedBuild,
  fixtureBuildRequest,
  fixtureConsoleInputs,
  fixtureVendorSdkEvidence,
  fixtureWebInputs,
} from "./fixtures.ts";

test("the fake executor is deterministic: same command, same outputs (E9)", () => {
  const executor: BuildExecutor = fakeBuildExecutor();
  const request = fixtureBuildRequest(fixtureWebInputs());
  const first = executor.execute({ request: fixtureAdmittedBuild(request, "build-exec-1") });
  const second = executor.execute({ request: fixtureAdmittedBuild(request, "build-exec-1") });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(
      computeBuildManifestDigest(first.outputs.manifest),
      computeBuildManifestDigest(second.outputs.manifest),
    );
    assert.deepEqual(first.outputs.artifacts, second.outputs.artifacts);
  }
});

test("the fake executor never fabricates vendor authorization (fail closed)", () => {
  const executor = fakeBuildExecutor();
  const request = fixtureBuildRequest(fixtureConsoleInputs());
  const refused = executor.execute({ request: fixtureAdmittedBuild(request, "build-exec-2") });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "vendor-evidence-required");
  }
});

test("with caller-supplied vendor evidence the fake executor completes and validates", () => {
  const executor = fakeBuildExecutor();
  const inputs = fixtureConsoleInputs();
  const request = fixtureBuildRequest(inputs);
  const executed = executor.execute({
    request: fixtureAdmittedBuild(request, "build-exec-3"),
    vendorEvidence: [fixtureVendorSdkEvidence(inputs)],
  });
  assert.equal(executed.ok, true);
  if (executed.ok) {
    assert.equal(validateBuildOutputs(executed.outputs, inputs).ok, true);
    const kinds = executed.outputs.verification.map((record) => record.kind);
    assert.equal(kinds.includes("vendor-sdk"), true);
    assert.equal(kinds.includes("on-target"), true);
  }
});

test("the port is a pure interface: executors are interchangeable values", () => {
  // A second, independent executor instance behaves identically — the port
  // carries no hidden mutable state.
  const a = fakeBuildExecutor();
  const b = fakeBuildExecutor();
  const request = fixtureBuildRequest(fixtureWebInputs());
  const first = a.execute({ request: fixtureAdmittedBuild(request, "build-exec-4") });
  const second = b.execute({ request: fixtureAdmittedBuild(request, "build-exec-4") });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.deepEqual(first.outputs, second.outputs);
  }
});
