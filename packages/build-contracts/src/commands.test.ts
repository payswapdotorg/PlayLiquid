/**
 * Build command admission: idempotent admission (E6), input resolution
 * refusals, and target/engine incompatibility refusals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitBuildRequest,
  admitCancelBuild,
  buildIdempotencyKeyEquals,
  buildInputDigests,
  computeBuildRequestFingerprint,
} from "./commands.ts";
import type { BuildRequestCommand, BuildStateRecord } from "./commands.ts";
import { asBuildId, asBuildNonce, asBuildTargetId, asRequesterId } from "./primitives.ts";
import type { BuildInputs } from "./inputs.ts";
import { fixtureAdmissionContext, fixtureBuildRequest, fixtureConsoleInputs, fixtureWebInputs } from "./fixtures.ts";

function resolvableWithout(inputs: BuildInputs, drop: "gameIr" | "packageLock" | "targetProfile" | "engineBinding" | "toolchain") {
  const digests = new Set(buildInputDigests(inputs).map((entry) => entry.digest));
  const dropped = buildInputDigests(inputs).find((entry) => entry.name === drop);
  assert.notEqual(dropped, undefined);
  digests.delete(dropped!.digest);
  return { resolvableDigests: digests, firstEncounter: null };
}

test("a well-formed request over resolvable inputs is admitted as first", () => {
  const inputs = fixtureWebInputs();
  const request = fixtureBuildRequest(inputs);
  const admission = admitBuildRequest(request, fixtureAdmissionContext(inputs));
  assert.equal(admission.ok, true);
  if (admission.ok) {
    assert.equal(admission.classification, "first");
    assert.equal(typeof admission.fingerprint, "string");
  }
});

test("re-submitting the same idempotency key and payload is a duplicate", () => {
  const inputs = fixtureWebInputs();
  const request = fixtureBuildRequest(inputs);
  const context = fixtureAdmissionContext(inputs);
  const first = admitBuildRequest(request, context);
  assert.equal(first.ok, true);
  const duplicate = admitBuildRequest(request, {
    resolvableDigests: context.resolvableDigests,
    firstEncounter: {
      key: request.idempotency,
      fingerprint: computeBuildRequestFingerprint(request),
      buildId: asBuildId("build-1"),
    },
  });
  assert.equal(duplicate.ok, true);
  if (duplicate.ok) {
    assert.equal(duplicate.classification, "duplicate");
    assert.equal(duplicate.buildId, "build-1");
  }
});

test("same key with a different payload is a collision and is refused (E8)", () => {
  const inputs = fixtureWebInputs();
  const request = fixtureBuildRequest(inputs);
  const tampered: BuildRequestCommand = {
    ...request,
    parameters: { kind: "record", fields: { "include-debug": { kind: "bool", value: true } } },
  };
  const admission = admitBuildRequest(tampered, {
    resolvableDigests: fixtureAdmissionContext(inputs).resolvableDigests,
    firstEncounter: {
      key: request.idempotency,
      fingerprint: computeBuildRequestFingerprint(request),
      buildId: asBuildId("build-1"),
    },
  });
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "idempotency-collision");
  }
});

test("request fingerprints are parameter field-order invariant (E9)", () => {
  const request = fixtureBuildRequest(fixtureWebInputs());
  const reordered: BuildRequestCommand = {
    ...request,
    parameters: {
      kind: "record",
      fields: {
        "another-flag": { kind: "bool", value: true },
        "include-debug": { kind: "bool", value: false },
      },
    },
  };
  const first = computeBuildRequestFingerprint({
    ...request,
    parameters: {
      kind: "record",
      fields: {
        "include-debug": { kind: "bool", value: false },
        "another-flag": { kind: "bool", value: true },
      },
    },
  });
  assert.equal(first, computeBuildRequestFingerprint(reordered));
  assert.notEqual(first, computeBuildRequestFingerprint(request));
});

test("every unresolvable input digest is refused with its input name", () => {
  const inputs = fixtureWebInputs();
  const request = fixtureBuildRequest(inputs);
  for (const name of ["gameIr", "packageLock", "targetProfile", "engineBinding", "toolchain"] as const) {
    const admission = admitBuildRequest(request, resolvableWithout(inputs, name));
    assert.equal(admission.ok, false, name);
    if (!admission.ok) {
      assert.equal(admission.code, "unresolvable-input");
      assert.equal(admission.input, name);
    }
  }
});

test("an engine binding that declares no support for the target is refused", () => {
  const inputs: BuildInputs = {
    ...fixtureWebInputs(),
    engineBinding: {
      ...fixtureWebInputs().engineBinding,
      supportedTargets: [asBuildTargetId("spark")],
    },
  };
  const request = fixtureBuildRequest(inputs);
  const admission = admitBuildRequest(request, fixtureAdmissionContext(inputs));
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "target-engine-incompatible");
    assert.match(admission.message, /declares no support for target/);
  }
});

test("an empty supported-targets declaration refuses every target", () => {
  const base = fixtureWebInputs();
  const inputs: BuildInputs = {
    ...base,
    engineBinding: { ...base.engineBinding, supportedTargets: [] },
  };
  const admission = admitBuildRequest(fixtureBuildRequest(inputs), fixtureAdmissionContext(inputs));
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "target-engine-incompatible");
  }
});

test("structurally invalid commands are refused before resolution", () => {
  const inputs = fixtureWebInputs();
  const badParameters = {
    ...fixtureBuildRequest(inputs),
    parameters: { kind: "bool", value: true },
  } as unknown as BuildRequestCommand;
  const admission = admitBuildRequest(badParameters, fixtureAdmissionContext(inputs));
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "invalid-command");
  }
});

test("console-class inputs with full resolution and a supporting binding admit", () => {
  const inputs = fixtureConsoleInputs();
  const admission = admitBuildRequest(fixtureBuildRequest(inputs), fixtureAdmissionContext(inputs));
  assert.equal(admission.ok, true);
});

test("cancelling a terminal build is refused; active builds are cancellable", () => {
  const command = {
    kind: "cancel-build",
    idempotency: {
      scope: "build-cancel",
      requester: asRequesterId("builder-agent"),
      nonce: asBuildNonce("cancel-1"),
    },
    buildId: asBuildId("build-1"),
    requestedAt: 1,
  } as const;
  const running: BuildStateRecord = { buildId: asBuildId("build-1"), phase: "emit", admittedAt: 1 };
  assert.equal(admitCancelBuild(command, running).ok, true);
  for (const phase of ["succeeded", "failed", "cancelled"] as const) {
    const terminal: BuildStateRecord = { buildId: asBuildId("build-1"), phase, admittedAt: 1 };
    const verdict = admitCancelBuild(command, terminal);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "build-not-cancellable");
    }
  }
});

test("cancel commands must name the build they target", () => {
  const command = {
    kind: "cancel-build",
    idempotency: {
      scope: "build-cancel",
      requester: asRequesterId("builder-agent"),
      nonce: asBuildNonce("cancel-1"),
    },
    buildId: asBuildId("build-2"),
    requestedAt: 1,
  } as const;
  const other: BuildStateRecord = { buildId: asBuildId("build-1"), phase: "queued", admittedAt: 1 };
  const verdict = admitCancelBuild(command, other);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "invalid-command");
  }
});

test("idempotency key equality is structural over all three fields", () => {
  const a = {
    scope: "build-request",
    requester: asRequesterId("agent-a"),
    nonce: asBuildNonce("n1"),
  } as const;
  assert.equal(buildIdempotencyKeyEquals(a, { ...a }), true);
  assert.equal(
    buildIdempotencyKeyEquals(a, { ...a, nonce: asBuildNonce("n2") }),
    false,
  );
  assert.equal(
    buildIdempotencyKeyEquals(a, { ...a, requester: asRequesterId("agent-b") }),
    false,
  );
});
