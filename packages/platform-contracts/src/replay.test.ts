import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  asReplayId,
  isReplayServicePolicy,
  isReplayEventBinding,
  isReplayArtifactDescriptor,
  isReplayQueryRequest,
  authorizeReplayAccess,
} from "./replay.ts";
import type { ReplayArtifactDescriptor } from "./replay.ts";

const tenant = asTenantId("tenant-alpha")!;
const otherTenant = asTenantId("tenant-beta")!;
const subject = asSubjectId("player-one")!;
const replayId = asReplayId("replay-001")!;
const digest = asContentDigest("ef".repeat(32))!;
const kind = asGameEventKind("match.completed")!;

function sealedArtifact(): ReplayArtifactDescriptor {
  return {
    replayId,
    tenant,
    subject,
    capture: "intent-log",
    digest,
    consumers: ["player", "qa", "integrity"],
    sealedBy: "platform-authority",
  };
}

test("replay: ids, policies and bindings validate", () => {
  assert.ok(asReplayId("replay-001"));
  assert.equal(asReplayId("REPLAY 001"), undefined);
  assert.ok(isReplayServicePolicy({ retentionDays: 90, verifyDeterminism: true, sealOnFinalize: true }));
  assert.equal(isReplayServicePolicy({ retentionDays: -1, verifyDeterminism: true, sealOnFinalize: true }), false);
  assert.ok(isReplayEventBinding({ capability: "replay", eventKind: kind }));
  assert.equal(isReplayEventBinding({ capability: "replay", eventKind: "" }), false);
});

test("replay: artifact descriptors carry digests and R8 consumers", () => {
  assert.ok(isReplayArtifactDescriptor(sealedArtifact()));
  assert.equal(isReplayArtifactDescriptor({ ...sealedArtifact(), digest: "nope" }), false);
  assert.equal(isReplayArtifactDescriptor({ ...sealedArtifact(), consumers: ["cheaters"] }), false);
  assert.equal(isReplayArtifactDescriptor({ ...sealedArtifact(), capture: "vibes" }), false);
  // Unsealed artifacts are structurally valid descriptors (sealing is a
  // lifecycle state, not a shape) but are refused by the access oracle.
  const unsealed: ReplayArtifactDescriptor = { ...sealedArtifact(), sealedBy: undefined };
  assert.ok(isReplayArtifactDescriptor(unsealed));
  assert.equal(isReplayArtifactDescriptor({ ...sealedArtifact(), sealedBy: "game-declared" }), false);
});

test("replay: catalog queries are consumer-scoped", () => {
  assert.ok(isReplayQueryRequest({ tenant, consumer: "qa", filter: {} }));
  assert.ok(isReplayQueryRequest({ tenant, consumer: "qa", filter: { subject } }));
  assert.equal(isReplayQueryRequest({ tenant, consumer: "cheaters", filter: {} }), false);
  assert.equal(isReplayQueryRequest({ tenant, consumer: "qa" }), false);
});

test("replay: access is granted only to sealed, declared, same-tenant consumers (R8/R20/E8)", () => {
  assert.deepEqual(authorizeReplayAccess({ tenant, consumer: "qa" }, sealedArtifact()), {
    granted: true,
    replayId,
  });

  assert.deepEqual(authorizeReplayAccess({ tenant, consumer: "lab" }, sealedArtifact()), {
    granted: false,
    code: "consumer-not-authorized",
    replayId,
  });

  assert.deepEqual(authorizeReplayAccess({ tenant: otherTenant, consumer: "qa" }, sealedArtifact()), {
    granted: false,
    code: "tenant-mismatch",
    replayId,
  });

  const unsealed: ReplayArtifactDescriptor = { ...sealedArtifact(), sealedBy: undefined };
  assert.deepEqual(authorizeReplayAccess({ tenant, consumer: "qa" }, unsealed), {
    granted: false,
    code: "artifact-not-sealed",
    replayId,
  });
});
