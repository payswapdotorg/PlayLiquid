import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asMatchSessionId } from "./multiplayer.ts";
import { asReplayId } from "./replay.ts";
import type { ReplayArtifactDescriptor } from "./replay.ts";
import {
  isReplayProvenanceLink,
  provenanceMatchesDescriptor,
  authoritativeRecordRefs,
} from "./replay-provenance.ts";
import type { ReplayProvenanceLink } from "./replay-provenance.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const replayId = asReplayId("replay-001")!;
const session = asMatchSessionId("session-0001")!;
const otherSession = asMatchSessionId("session-0002")!;
const replayDigest = asContentDigest("ef".repeat(32))!;
const otherDigest = asContentDigest("ab".repeat(32))!;
const sessionRecordDigest = asContentDigest("cd".repeat(32))!;
const runtimeRecordDigest = asContentDigest("12".repeat(32))!;
const capturePolicyDigest = asContentDigest("34".repeat(32))!;

function link(overrides: Partial<ReplayProvenanceLink> = {}): ReplayProvenanceLink {
  const full: ReplayProvenanceLink = {
    replayId,
    replayDigest,
    tenant,
    session,
    sessionRecordDigest,
    runtimeRecordDigest,
    capturePolicyDigest,
  };
  return { ...full, ...overrides };
}

function artifact(overrides: Partial<ReplayArtifactDescriptor> = {}): ReplayArtifactDescriptor {
  const full: ReplayArtifactDescriptor = {
    replayId,
    tenant,
    subject,
    session,
    capture: "intent-log",
    digest: replayDigest,
    consumers: ["player", "qa"],
    sealedBy: "platform-authority",
  };
  return { ...full, ...overrides };
}

test("provenance: well-formed links validate", () => {
  assert.ok(isReplayProvenanceLink(link()));
  assert.ok(isReplayProvenanceLink(link({ session: undefined })));
  assert.equal(isReplayProvenanceLink({ ...link(), replayDigest: "junk" as never }), false);
  assert.equal(isReplayProvenanceLink({ ...link(), sessionRecordDigest: "junk" as never }), false);
  assert.equal(isReplayProvenanceLink({ ...link(), runtimeRecordDigest: "junk" as never }), false);
  assert.equal(isReplayProvenanceLink({ ...link(), capturePolicyDigest: "junk" as never }), false);
  assert.equal(isReplayProvenanceLink({ ...link(), replayId: "" }), false);
  assert.equal(isReplayProvenanceLink({ ...link(), session: "" }), false);
  assert.equal(isReplayProvenanceLink(null), false);
});

test("provenance: links reference authoritative records by DIGEST, never state", () => {
  const keys = Object.keys(link()).sort();
  assert.deepEqual(keys, [
    "capturePolicyDigest",
    "replayDigest",
    "replayId",
    "runtimeRecordDigest",
    "session",
    "sessionRecordDigest",
    "tenant",
  ]);
  // No standings, scores or any session FACT appears on the link.
  for (const forbidden of ["standings", "scores", "outcome", "ranks"]) {
    assert.equal((link() as unknown as Record<string, unknown>)[forbidden], undefined);
  }
  const refs = authoritativeRecordRefs(link());
  assert.deepEqual(refs, {
    sessionRecordDigest,
    runtimeRecordDigest,
    capturePolicyDigest,
  });
});

test("provenance: coherent links match their canonical descriptor", () => {
  assert.ok(provenanceMatchesDescriptor(link(), artifact()));
  // Session-less links match session-less descriptors.
  assert.ok(provenanceMatchesDescriptor(link({ session: undefined }), artifact({ session: undefined })));
});

test("provenance: incoherent links are refused, never silently merged (E1/E8)", () => {
  // Different artifact content.
  assert.equal(provenanceMatchesDescriptor(link({ replayDigest: otherDigest }), artifact()), false);
  // Different replay id.
  assert.equal(
    provenanceMatchesDescriptor(link({ replayId: asReplayId("replay-999")! }), artifact()),
    false,
  );
  // Different tenant.
  assert.equal(
    provenanceMatchesDescriptor(link({ tenant: asTenantId("tenant-beta")! }), artifact()),
    false,
  );
  // A link claiming a session the descriptor does not carry.
  assert.equal(provenanceMatchesDescriptor(link(), artifact({ session: undefined })), false);
  // A link claiming a DIFFERENT session than the descriptor.
  assert.equal(provenanceMatchesDescriptor(link({ session: otherSession }), artifact()), false);
});

test("provenance: links are readonly data (E1 compile check)", () => {
  const record: ReplayProvenanceLink = link();
  // @ts-expect-error — E1: contract fields are readonly
  record.runtimeRecordDigest = otherDigest;
  assert.equal(record.replayId, replayId);
});
