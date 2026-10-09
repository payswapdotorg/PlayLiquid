/**
 * Topology tests: frozen enum, platform vocabulary mapping, per-topology
 * admission rules, and the configuration resolution door that binds
 * platform-contracts' `validateCapabilityPolicy` refusal (lock 19) into
 * kernel behavior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MULTIPLAYER_TOPOLOGIES,
  TOPOLOGY_RULES,
  isMultiplayerTopology,
  kernelTopologyFromServicePolicy,
  resolveMultiplayerConfiguration,
  topologyRules,
} from "./topology.ts";
import { createFakeGamePolicy } from "./fakes.ts";
import type { MultiplayerServicePolicy } from "@playliquid/platform-contracts";
import { isMultiplayerServicePolicy } from "@playliquid/platform-contracts";
import { asGameEventKind } from "@playliquid/platform-contracts";

const authoritative: MultiplayerServicePolicy = {
  topology: "authoritative-server",
  competitiveUse: true,
  admission: "open",
};

test("topology: frozen enum covers exactly the three work-order topologies", () => {
  assert.deepEqual([...MULTIPLAYER_TOPOLOGIES], ["dedicated-server", "client-server", "peer-to-peer"]);
  assert.ok(isMultiplayerTopology("peer-to-peer"));
  assert.equal(isMultiplayerTopology("authoritative-server"), false);
  assert.equal(isMultiplayerTopology("mesh"), false);
});

test("topology: platform vocabulary maps 1:1 onto the kernel enum", () => {
  assert.equal(kernelTopologyFromServicePolicy("authoritative-server"), "dedicated-server");
  assert.equal(kernelTopologyFromServicePolicy("authoritative-relay"), "client-server");
  assert.equal(kernelTopologyFromServicePolicy("peer-to-peer"), "peer-to-peer");
});

test("topology: peer-to-peer may never decide protected outcomes (lock 19)", () => {
  assert.equal(TOPOLOGY_RULES["peer-to-peer"].mayDecideProtectedOutcomes, false);
  assert.equal(TOPOLOGY_RULES["peer-to-peer"].competitiveUseSupported, false);
  assert.equal(TOPOLOGY_RULES["dedicated-server"].mayDecideProtectedOutcomes, true);
  assert.equal(TOPOLOGY_RULES["client-server"].mayDecideProtectedOutcomes, true);
});

test("topology: origin admission differs per topology", () => {
  assert.ok(topologyRules("dedicated-server").admittedOrigins.includes("platform-system"));
  assert.equal(topologyRules("dedicated-server").admittedOrigins.includes("host-authority"), false);
  assert.ok(topologyRules("client-server").admittedOrigins.includes("host-authority"));
  assert.equal(topologyRules("peer-to-peer").admittedOrigins.includes("host-authority"), false);
  assert.equal(topologyRules("peer-to-peer").admittedOrigins.includes("platform-system"), false);
});

test("configuration: happy path resolves topology, rules, bindings, capacity", () => {
  const resolution = resolveMultiplayerConfiguration(createFakeGamePolicy(), authoritative);
  assert.ok(resolution.ok);
  assert.equal(resolution.configuration.topology, "dedicated-server");
  assert.equal(resolution.configuration.capacity, 4);
  assert.deepEqual(
    resolution.configuration.protectedEventKinds.map((kind) => String(kind)).sort(),
    ["match.damage-dealt", "match.scored"],
  );
  assert.deepEqual(resolution.configuration.informationalEventKinds.map((kind) => String(kind)), ["match.moved"]);
});

test("configuration: structurally invalid service policy is refused", () => {
  const competitiveP2p = { topology: "peer-to-peer", competitiveUse: true, admission: "open" } as MultiplayerServicePolicy;
  assert.equal(isMultiplayerServicePolicy(competitiveP2p), false, "platform guard refuses competitive P2P");
  const resolution = resolveMultiplayerConfiguration(createFakeGamePolicy(), competitiveP2p);
  assert.ok(!resolution.ok);
  assert.equal(resolution.code, "invalid-service-policy");
});

test("configuration: competitive P2P game policy surfaces the platform refusal code (binding)", () => {
  const resolution = resolveMultiplayerConfiguration(
    createFakeGamePolicy("peer-to-peer"),
    { topology: "peer-to-peer", competitiveUse: false, admission: "open" },
  );
  assert.ok(!resolution.ok);
  assert.equal(resolution.code, "competitive-p2p-topology", "validateCapabilityPolicy's refusal is bound in");
  assert.ok(resolution.detail.includes("protected outcome event"));
});

test("configuration: non-competitive P2P with protected bindings is still refused (defense in depth)", () => {
  const gamePolicy = createFakeGamePolicy("peer-to-peer");
  const resolution = resolveMultiplayerConfiguration(
    gamePolicy,
    { topology: "peer-to-peer", competitiveUse: false, admission: "open" },
  );
  assert.ok(!resolution.ok);
  assert.equal(resolution.code, "competitive-p2p-topology");
});

test("configuration: game without the multiplayer capability is refused", () => {
  const gamePolicy = { ...createFakeGamePolicy(), capabilities: [], bindings: [] };
  const resolution = resolveMultiplayerConfiguration(gamePolicy, authoritative);
  assert.ok(!resolution.ok);
  assert.equal(resolution.code, "multiplayer-capability-absent");
});

test("configuration: topology disagreement between game and service is refused", () => {
  const resolution = resolveMultiplayerConfiguration(
    createFakeGamePolicy("authoritative-relay"),
    authoritative,
  );
  assert.ok(!resolution.ok);
  assert.equal(resolution.code, "topology-disagreement");
});

test("configuration: a broken game policy is refused with its first reason", () => {
  const broken: Parameters<typeof resolveMultiplayerConfiguration>[0] = {
    ...createFakeGamePolicy(),
    bindings: [
      ...createFakeGamePolicy().bindings,
      {
        capability: "multiplayer" as const,
        eventKind: asGameEventKind("match.completed")!,
        outcomeClassification: "protected" as const,
      },
    ],
  };
  const resolution = resolveMultiplayerConfiguration(broken, authoritative);
  assert.ok(!resolution.ok);
  assert.equal(resolution.code, "game-policy-invalid");
});

test("configuration: P2P with informational-only bindings resolves fine", () => {
  const gamePolicy = createFakeGamePolicy("peer-to-peer");
  const informationalOnly: Parameters<typeof resolveMultiplayerConfiguration>[0] = {
    ...gamePolicy,
    bindings: gamePolicy.bindings.map((binding) =>
      binding.capability === "multiplayer" && binding.outcomeClassification === "protected"
        ? { ...binding, outcomeClassification: "informational" as const }
        : binding,
    ),
  };
  const resolution = resolveMultiplayerConfiguration(
    informationalOnly,
    { topology: "peer-to-peer", competitiveUse: false, admission: "open" },
  );
  assert.ok(resolution.ok);
  assert.equal(resolution.configuration.topology, "peer-to-peer");
  assert.equal(resolution.configuration.protectedEventKinds.length, 0);
});
