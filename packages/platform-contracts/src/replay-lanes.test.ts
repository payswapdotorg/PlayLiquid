import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asReplayId } from "./replay.ts";
import type { ReplayArtifactDescriptor } from "./replay.ts";
import {
  REPLAY_LANES,
  isReplayLane,
  isReplayLaneRequest,
  authorizeReplayLaneRequest,
} from "./replay-lanes.ts";
import type {
  PlayerReplayRequest,
  QaReplayRequest,
  IntegrityReplayRequest,
  SimulationReplayRequest,
  LabReplayRequest,
  ReplayLaneRequest,
  ReplayLaneView,
} from "./replay-lanes.ts";

const tenant = asTenantId("tenant-alpha")!;
const otherTenant = asTenantId("tenant-beta")!;
const subject = asSubjectId("player-one")!;
const otherSubject = asSubjectId("player-two")!;
const replayId = asReplayId("replay-001")!;
const digest = asContentDigest("ef".repeat(32))!;

function artifact(overrides: Partial<ReplayArtifactDescriptor> = {}): ReplayArtifactDescriptor {
  const full: ReplayArtifactDescriptor = {
    replayId,
    tenant,
    subject,
    capture: "intent-log",
    digest,
    consumers: ["player", "qa", "integrity", "simulation", "lab"],
    sealedBy: "platform-authority",
  };
  return { ...full, ...overrides };
}

const playerRequest: PlayerReplayRequest = { lane: "player", tenant, requester: subject, replayId };
const qaRequest: QaReplayRequest = { lane: "qa", tenant, replayId, harnessDigest: digest };
const integrityRequest: IntegrityReplayRequest = {
  lane: "integrity",
  tenant,
  replayId,
  evidenceScope: "behavioral-evidence",
};
const simulationRequest: SimulationReplayRequest = {
  lane: "simulation",
  tenant,
  replayId,
  determinismRequired: true,
  seedRef: digest,
};
const labRequest: LabReplayRequest = { lane: "lab", tenant, replayId, studyRef: digest };

test("replay-lanes: the lane vocabulary reuses the frozen R8 consumer list", () => {
  assert.ok(Object.isFrozen(REPLAY_LANES));
  assert.deepEqual([...REPLAY_LANES], ["player", "qa", "integrity", "simulation", "lab"]);
  assert.ok(isReplayLane("lab"));
  assert.equal(isReplayLane("cheaters"), false);
  assert.equal(isReplayLane("spectator"), false);
});

test("replay-lanes: all five lane request shapes validate", () => {
  for (const request of [
    playerRequest,
    qaRequest,
    integrityRequest,
    simulationRequest,
    labRequest,
  ] as ReplayLaneRequest[]) {
    assert.ok(isReplayLaneRequest(request), `${request.lane} request should validate`);
  }
});

test("replay-lanes: malformed lane requests are refused (negative paths)", () => {
  // Player without a requester.
  assert.equal(isReplayLaneRequest({ ...playerRequest, requester: "" }), false);
  // QA without a digest-pinned harness.
  assert.equal(isReplayLaneRequest({ ...qaRequest, harnessDigest: "junk" as never }), false);
  // Integrity with a foreign evidence scope.
  assert.equal(isReplayLaneRequest({ ...integrityRequest, evidenceScope: "everything" as never }), false);
  // Simulation without the determinism pin or with a junk seed.
  assert.equal(isReplayLaneRequest({ ...simulationRequest, determinismRequired: false as never }), false);
  assert.equal(isReplayLaneRequest({ ...simulationRequest, seedRef: "junk" as never }), false);
  // Lab without a study reference.
  assert.equal(isReplayLaneRequest({ ...labRequest, studyRef: "junk" as never }), false);
  // Unknown lanes never validate.
  assert.equal(isReplayLaneRequest({ lane: "cheaters", tenant, replayId }), false);
  assert.equal(isReplayLaneRequest(null), false);
});

test("replay-lanes: simulation determinism is a structural literal (compile check)", () => {
  // @ts-expect-error — determinismRequired is the literal type true
  const loose: SimulationReplayRequest = { ...simulationRequest, determinismRequired: false };
  assert.equal(loose.determinismRequired, false);
});

test("replay-lanes: each lane is granted its typed view over the ONE canonical record", () => {
  const cases: readonly [ReplayLaneRequest, ReplayLaneView["lane"], ReplayLaneView["view"]][] = [
    [playerRequest, "player", "own-subject"],
    [qaRequest, "qa", "assertion-harness"],
    [integrityRequest, "integrity", "evidence-extraction"],
    [simulationRequest, "simulation", "deterministic-replay"],
    [labRequest, "lab", "labeled-estimate-only"],
  ];
  for (const [request, lane, view] of cases) {
    const decision = authorizeReplayLaneRequest(request, artifact());
    assert.ok(decision.granted, `${lane} should be granted`);
    if (decision.granted) {
      assert.equal(decision.view.lane, lane);
      assert.equal(decision.view.view, view);
      // The view WRAPS the canonical descriptor — same object, no copy.
      assert.equal(decision.view.artifact.replayId, replayId);
      assert.equal(decision.view.artifact.digest, digest);
    }
  }
});

test("replay-lanes: tenant isolation is enforced on every lane (R20)", () => {
  const decision = authorizeReplayLaneRequest({ ...qaRequest, tenant: otherTenant }, artifact());
  assert.deepEqual(decision, { granted: false, code: "tenant-mismatch", replayId });
});

test("replay-lanes: undeclared lanes and unsealed artifacts are refused (R8 negative paths)", () => {
  const undeclared = authorizeReplayLaneRequest(
    labRequest,
    artifact({ consumers: ["player", "qa"] }),
  );
  assert.deepEqual(undeclared, { granted: false, code: "lane-not-declared", replayId });
  const unsealed = authorizeReplayLaneRequest(qaRequest, artifact({ sealedBy: undefined }));
  assert.deepEqual(unsealed, { granted: false, code: "artifact-not-sealed", replayId });
});

test("replay-lanes: the player lane is own-subject scoped (lane-scope violation, E8)", () => {
  // A player requesting ANOTHER subject's replay through the player lane.
  const snooping = authorizeReplayLaneRequest(
    { ...playerRequest, requester: otherSubject },
    artifact(),
  );
  assert.deepEqual(snooping, { granted: false, code: "lane-scope-violation", replayId });
  // The same artifact IS readable by its own subject.
  const own = authorizeReplayLaneRequest(playerRequest, artifact({ subject }));
  assert.ok(own.granted);
  // The own-subject rule is lane-specific: the QA lane reads the same
  // artifact without being the subject (that is its declared purpose).
  const qaRead = authorizeReplayLaneRequest(qaRequest, artifact({ subject }));
  assert.ok(qaRead.granted);
});

test("replay-lanes: malformed requests are refused with the precise code", () => {
  const decision = authorizeReplayLaneRequest({ lane: "cheaters", tenant, replayId }, artifact());
  assert.deepEqual(decision, { granted: false, code: "malformed-request", replayId });
});

test("replay-lanes: lane views are readonly data (E1 compile check)", () => {
  const decision = authorizeReplayLaneRequest(playerRequest, artifact());
  assert.ok(decision.granted);
  if (!decision.granted) return;
  // @ts-expect-error — E1: contract fields are readonly
  decision.view.view = "evidence-extraction";
  assert.equal(decision.view.lane, "player");
});
