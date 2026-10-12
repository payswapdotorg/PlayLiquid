/**
 * SECURITY RIG FIXTURES (PL-041) — the deterministic package/broker/avatar
 * fixture builders, split from rig.ts for the 400-line ceiling (the
 * qa/browser studio-fixtures precedent).
 *
 * Every builder is deterministic (E9): fixed seeds, fixed versions,
 * content-derived digests. The RIG constants they need arrive as explicit
 * arguments (no import cycle with rig.ts).
 */

import { createRegistryIndex } from "@playliquid/package-registry";
import { publishRecordToCas } from "@playliquid/package-registry";
import type { RegistryReadPort } from "./ports.ts";
import { createArtifactStore } from "@playliquid/artifact-store";
import { InMemoryBlobStore } from "@playliquid/artifact-store";
import type { ArtifactStore } from "@playliquid/artifact-store";
import { sealPackageRecord } from "@playliquid/package-system";
import type { PackageRecord, UnsealedPackageRecord } from "@playliquid/package-system";
import { composeAvatar } from "@playliquid/avatar-runtime";
import { demoAvatarInput } from "@playliquid/avatar-runtime";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import { CapabilityBroker } from "@playliquid/capability-broker";
import { avatarActor, brokerPolicy, capId, grantId, makeGrant, seedGrants } from "@playliquid/capability-broker";
import { ManualBrokerClock } from "@playliquid/capability-broker";
import { asSessionId } from "@playliquid/runtime-contracts";

const RIG_VERSION = { major: 1, minor: 0, patch: 0, prerelease: [] as string[], build: [] as string[] };

function rigMetadata(licenseStatus: "verified" | "declared", withHistory: boolean): UnsealedPackageRecord["metadata"] {
  return {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: licenseStatus },
    provenance: {
      origin: { type: "original" },
      sourceCommit: "fedcba9876543210fedcba9876543210fedcba98",
      transformationHistory: withHistory
        ? [{ kind: "author", description: "authored for the security rig corpus" }]
        : [],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["simulation"], engines: [], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
  };
}

/** The PL-011 fixture corpus: three sealed records in a permissive-mode registry + CAS. */
export function buildPackageCorpus(): {
  readonly blobStore: InMemoryBlobStore;
  readonly artifacts: ArtifactStore;
  readonly registry: RegistryReadPort;
  readonly packages: {
    readonly good: PackageRecord;
    readonly unlicensed: PackageRecord;
    readonly provenanceGap: PackageRecord;
  };
} {
  const blobStore = new InMemoryBlobStore();
  const artifacts = createArtifactStore({ blobStore });
  const good = sealPackageRecord({
    identity: { kind: "assets", id: "asset.rig-kit", version: RIG_VERSION },
    metadata: rigMetadata("verified", true),
  });
  const unlicensed = sealPackageRecord({
    identity: { kind: "assets", id: "asset.rig-unlicensed", version: RIG_VERSION },
    metadata: rigMetadata("declared", true),
  });
  const provenanceGap = sealPackageRecord({
    identity: { kind: "assets", id: "asset.rig-orphan", version: RIG_VERSION },
    metadata: rigMetadata("verified", false),
  });
  const registry = createRegistryIndex({ enforceReleaseGate: false });
  for (const record of [good, unlicensed, provenanceGap]) {
    const published = registry.publish(record);
    if (!published.ok) throw new Error(`rig: record ${record.identity.id} not published: ${published.message}`);
    const stored = publishRecordToCas(artifacts, record);
    if (!stored.ok) throw new Error(`rig: record ${record.identity.id} not stored: ${stored.message}`);
  }
  return { blobStore, artifacts, registry, packages: { good, unlicensed, provenanceGap } };
}

/** The PL-026 broker: speech host-denied at grant admission; movement seeded. */
export function buildRigBroker(deps: {
  readonly sessionId: string;
  readonly avatarSubject: string;
  readonly otherHolder: string;
}): CapabilityBroker {
  const policy = brokerPolicy(
    [
      {
        capability: capId("avatar.movement"),
        intentKinds: ["move.to"],
        commandKindByIntent: { "move.to": "world.move" },
      },
    ],
    { denied: [capId("avatar.speech")], approvalRequired: [] },
  );
  if (!policy.ok) throw new Error(`rig: broker policy invalid: ${policy.detail}`);
  const broker = new CapabilityBroker({
    policy: policy.policy,
    clock: new ManualBrokerClock(0),
    commandIdPrefix: "rig",
  });
  seedGrants(broker, [
    makeGrant({
      grantId: grantId("grant-rig-movement"),
      holder: avatarActor(deps.avatarSubject),
      capability: capId("avatar.movement"),
      scope: { sessionId: asSessionId(deps.sessionId) },
    }),
    makeGrant({
      grantId: grantId("grant-rig-other-holder"),
      holder: avatarActor(deps.otherHolder),
      capability: capId("avatar.movement"),
      scope: { sessionId: asSessionId(deps.sessionId) },
    }),
  ]);
  return broker;
}

/** The composed avatar definition (PL-026 demo input — the journey's body). */
export function buildRigAvatarDefinition(): AvatarDefinition {
  const composed = composeAvatar(demoAvatarInput());
  if (!composed.ok) throw new Error(`rig: avatar fixture invalid: ${composed.detail}`);
  return composed.definition;
}
