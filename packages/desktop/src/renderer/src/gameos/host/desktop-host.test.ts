/**
 * DESKTOP PRODUCT HOST TESTS (RW-001): the store/view-model level tests of
 * the product shell's REAL host-wired ports — the acceptance evidence for
 * the shell adapters (`node --test`, the package pattern).
 *
 * What is pinned here:
 * - the composed host opens its REAL package registry and every port's
 *   first snapshot is the composed services' REAL empty state (no fixtures,
 *   no demoStudioSnapshot, no StaticStudioDataPort — lock rule 44);
 * - Game Studio: a record published through the registry's own publish
 *   door surfaces through DesktopStudioDataPort with its release-gate
 *   verdict, and the game-ui store mounts + refreshes over the port;
 * - Lab: with a pinned local project identity, a request-search intent
 *   opens a REAL search and the data port streams the whole candidate
 *   space; the gameos-lab store mounts over the two ports and its command
 *   log records the typed receipts; without the pinned identity the host
 *   refuses honestly (E11);
 * - Community: a submit intent flows through the REAL community service
 *   (accept, typed duplicate replay, typed workflow refusals, honest
 *   lineage refusal) and the gameos-community store mounts over the ports.
 *
 * Test-support usage (lock rule 44, TEST-ONLY): makeRecord builds one
 * registry record through the REAL seal path (node:crypto digests); the
 * pinned GameIdentity mirrors what a git-backed vite build injects.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asCommitSha, asGameId, isGameIdentity } from "../../../../../../game-contracts/src/index.ts";
// Test-support usage (lock rule 44, TEST-ONLY): the record below is built
// INLINE through the REAL public seal door (sealPackageRecord + parseSemver)
// instead of importing another module's test fixtures — cross-module access
// goes through public entries only (architecture rule).
import {
  parseSemver,
  sealPackageRecord,
} from "../../../../../../package-system/src/index.ts";
import type {
  PackageMetadata,
  PackageRecord,
} from "../../../../../../package-system/src/index.ts";
// PL-043 precedent (see architecture-policy.yaml deep-import exception):
// the game-ui / gameos-lab / gameos-community index.ts re-export .tsx
// components and plain `node --test` cannot load .tsx; the deep-import
// targets below are the .ts implementation files behind those entrypoints
// (the stores this test mounts per the PL-033 recipe), never private
// helpers.
import { createStudioStore } from "../../../../../../game-ui/src/studio-store.ts";
import { createLabStore } from "../../../../../../web/gameos-lab/src/lab-store.ts";
import { createCommunityStore } from "../../../../../../web/gameos-community/src/community-store.ts";
import { LOCAL_MODEL_ROUTE, LOCAL_ROLE_VOCABULARY } from "../identity.ts";
import { createDesktopProductHost } from "./desktop-host.ts";

/** Test-only: one gate-passing record sealed through the REAL digest path. */
function makeHostTestRecord(): PackageRecord {
  const metadata: PackageMetadata = {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: {
      origin: { type: "original" },
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      transformationHistory: [
        { kind: "author", description: "authored for the desktop host test" },
      ],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["simulation"], engines: ["native"], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
  };
  return sealPackageRecord({
    identity: { kind: "system", id: "sys.host-test", version: parseSemver("1.0.0")! },
    metadata,
  });
}

/** The build commit a git-backed build injects (vite define). */
const COMMIT = asCommitSha("0123456789abcdef0123456789abcdef01234567")!;

/** The pinned local project identity (mirrors identity.ts's shape). */
function pinnedLocalProjectIdentity() {
  const id = asGameId("game-playliquid-gameos");
  assert.ok(id !== undefined);
  return {
    id,
    displayName: "PlayLiquid GameOS",
    kind: "toolkit" as const,
    repository: { host: "github.com", owner: "payswapdotorg", repository: "PlayLiquid" },
    revision: { kind: "commit" as const, commit: COMMIT },
    lineage: { head: COMMIT, ancestors: [] },
  };
}

test("the host composes the real services and answers empty first snapshots", async () => {
  const host = await createDesktopProductHost({ localProjectIdentity: pinnedLocalProjectIdentity() });
  const studio = host.studio.port.load();
  assert.equal(studio.ok, true);
  assert.deepEqual(studio.data.packages, []);
  assert.deepEqual(studio.data.gateResults, {});
  assert.deepEqual(studio.data.operations, []);
  assert.deepEqual(studio.data.avatars, []);
  assert.deepEqual(studio.data.registrations, []);
  assert.deepEqual(studio.data.jobs, []);
  assert.ok(studio.data.policy !== undefined); // the real broker policy
  assert.equal(studio.data.broker, host.studio.broker); // the live broker itself

  const lab = host.lab.data.load();
  assert.equal(lab.ok, true);
  assert.equal(String(lab.data.viewer.tenant), String(host.viewer.tenant));
  assert.deepEqual(lab.data.searches, []);
  assert.deepEqual(lab.data.evidence, []);
  assert.deepEqual(lab.data.arenaCases, []); // honest: no Arena connection

  const community = host.community.data.load();
  assert.equal(community.ok, true);
  assert.deepEqual(community.data.contributions, []);
  assert.deepEqual(community.data.transitions, []);
  assert.equal(host.capabilityGaps().length, 0);
  assert.equal(host.replayRecords().length, 0);
});

test("Studio: a real registry publish surfaces through the data port with its gate verdict", async () => {
  const host = await createDesktopProductHost({ localProjectIdentity: pinnedLocalProjectIdentity() });
  const record = makeHostTestRecord();
  const published = await host.studio.registry.publish(record);
  assert.equal(published.ok, true);

  const snapshot = host.studio.port.load();
  assert.ok(snapshot.ok);
  assert.equal(snapshot.data.packages.length, 1);
  assert.equal(snapshot.data.packages[0]!.identity.id, "sys.host-test");
  assert.equal(snapshot.data.gateResults["sys.host-test"]!.pass, true);

  // The game-ui store mounts from the first snapshot through the port and
  // refreshes through the same seam (the PL-033 mount recipe).
  const store = createStudioStore(snapshot.data, host.studio.port);
  assert.equal(store.view().packages.cards.length, 1);
  assert.equal(store.view().packages.cards[0]!.id, "sys.host-test");
  const before = store.view().packages.cards.length;
  store.dispatch({ type: "select-package", packageId: "sys.host-test" });
  assert.equal(store.view().selection.packageId, "sys.host-test");
  assert.equal(store.view().selection.tab, "packages");
  assert.equal(before, 1);
});

test("Lab: a request-search intent opens a real search and streams the whole space", async () => {
  const host = await createDesktopProductHost({ localProjectIdentity: pinnedLocalProjectIdentity() });
  const opened = host.lab.command.dispatch({
    kind: "request-search",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    cycleId: "cycle-host-test-1",
    seed: "seed-host-test-1",
    maxAgents: 3,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.duplicate, false);
  assert.ok(opened.size > 0);

  const snapshot = host.lab.data.load();
  assert.ok(snapshot.ok);
  assert.equal(snapshot.data.searches.length, 1);
  const searchId = snapshot.data.searches[0]!.searchId;
  const stream = snapshot.data.candidateStreams[searchId]!;
  // The walk pages the whole candidate space (space size == emitted count).
  assert.equal(stream.length, opened.size);
  // The stream is the seed-derived traversal permutation (position ≠
  // spaceIndex): the generalist baseline is guaranteed PRESENT in the
  // stream exactly once (lock 26) — the canonical gameos-lab view-model
  // test asserts the same `.some(isBaseline)` visibility contract.
  assert.equal(stream.filter((candidate) => candidate.isBaseline).length, 1);
  assert.ok(
    stream.some((candidate) => candidate.isBaseline),
    "the generalist baseline candidate is visible in the stream (lock 26)",
  );
  // Traversal order: positions are dense 0..size-1 with no drops or repeats.
  assert.equal(
    stream.filter((candidate, index) => candidate.position === index).length,
    opened.size,
    "every traversal position appears exactly once, in order",
  );
  // E10: a replayed identical intent returns the recorded receipt.
  const replay = host.lab.command.dispatch({
    kind: "request-search",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    cycleId: "cycle-host-test-1",
    seed: "seed-host-test-1",
    maxAgents: 3,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  // A refreshed snapshot keeps every emitted candidate (nothing drops, E11).
  const refreshed = host.lab.data.load();
  assert.ok(refreshed.ok);
  assert.equal(refreshed.data.candidateStreams[searchId]!.length, opened.size);
});

test("Lab: the gameos-lab store mounts over the two ports and logs typed command outcomes", async () => {
  const host = await createDesktopProductHost({ localProjectIdentity: pinnedLocalProjectIdentity() });
  const first = host.lab.data.load();
  assert.ok(first.ok);
  const store = createLabStore(first.data, { data: host.lab.data, command: host.lab.command });
  assert.equal(store.view().searches.rows.length, 0);

  const receipt = store.dispatchCommand({
    kind: "request-search",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    cycleId: "cycle-host-test-2",
    seed: "seed-host-test-2",
    maxAgents: 2,
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.state().commandLog.length, 1);
  assert.equal(store.state().commandLog[0]!.receipt.ok, true);
  store.refresh();
  assert.equal(store.view().searches.rows.length, 1);
});

test("Lab: without a pinned project revision the host refuses searches honestly", async () => {
  // present-but-undefined forces the honest no-context path (identity.ts
  // returns undefined when the build commit is not a 40-hex sha).
  const host = await createDesktopProductHost({ localProjectIdentity: undefined });
  const refused = host.lab.command.dispatch({
    kind: "request-search",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    cycleId: "cycle-host-test-3",
    seed: "seed-host-test-3",
    maxAgents: 2,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "invalid-context");
  assert.match(refused.detail, /no pinned local project revision/);
});

test("Lab: gap rung intents refuse with the authoritative codes verbatim", async () => {
  const host = await createDesktopProductHost({ localProjectIdentity: pinnedLocalProjectIdentity() });
  const unknown = host.lab.command.dispatch({
    kind: "advance-gap-rung",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    gapId: "gap-never-recorded",
    rung: "existing-organization",
    disposition: "attempted",
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "gap-unknown");
  // The UI seam's own invalid-intent code for a declined autonomous rung.
  const declined = host.lab.command.dispatch({
    kind: "advance-gap-rung",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    gapId: "gap-never-recorded",
    rung: "alternate-organization",
    disposition: "declined",
  });
  assert.equal(declined.ok, false);
  assert.equal(declined.code, "invalid-intent");
});

test("Community: submit/advance flow through the real service with typed outcomes", async () => {
  const host = await createDesktopProductHost();
  const submitted = host.community.command.dispatch({
    kind: "submit-contribution",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    contributionKind: "code",
    label: "host test contribution",
    aiGenerated: false,
    lineageDerived: false,
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.duplicate, false);
  assert.match(String(submitted.contributionId), /^sha256:[0-9a-f]{64}$/);

  // E10: the replayed submission surfaces the recorded receipt.
  const replay = host.community.command.dispatch({
    kind: "submit-contribution",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    contributionKind: "code",
    label: "host test contribution",
    aiGenerated: false,
    lineageDerived: false,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(String(replay.contributionId), String(submitted.contributionId));

  // The read model reflects the recorded contribution + its intake transition.
  const snapshot = host.community.data.load();
  assert.ok(snapshot.ok);
  assert.equal(snapshot.data.contributions.length, 1);
  assert.equal(snapshot.data.transitions.length, 1);

  // An impossible workflow command refuses with the service's own code.
  const refused = host.community.command.dispatch({
    kind: "advance-contribution",
    tenant: host.viewer.tenant,
    actor: host.viewer.subject,
    contributionId: String(submitted.contributionId),
    command: "withdraw",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "invalid-transition");

  // The maintainer (the local operator, by host composition) triages for real.
  const triaged = host.community.command.dispatch({
    kind: "advance-contribution",
    tenant: host.viewer.tenant,
    actor: host.viewer.subject,
    contributionId: String(submitted.contributionId),
    command: "triage",
  });
  assert.equal(triaged.ok, true);
  assert.equal(triaged.to, "triaged");
});

test("Community: the gameos-community store mounts over the two ports", async () => {
  const host = await createDesktopProductHost();
  const first = host.community.data.load();
  assert.ok(first.ok);
  const store = createCommunityStore(first.data, {
    data: host.community.data,
    command: host.community.command,
  });
  assert.equal(store.view().contributions.rows.length, 0);
  const receipt = store.dispatchCommand({
    kind: "submit-contribution",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    contributionKind: "skill",
    label: "a skill from the local operator",
    aiGenerated: false,
    lineageDerived: false,
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.state().commandLog.length, 1);
  store.refresh();
  assert.equal(store.view().contributions.rows.length, 1);
});

test("Community: lineage-derived submissions refuse without a published base", async () => {
  const host = await createDesktopProductHost();
  const refused = host.community.command.dispatch({
    kind: "submit-contribution",
    tenant: host.viewer.tenant,
    subject: host.viewer.subject,
    contributionKind: "package",
    label: "derived from nothing",
    aiGenerated: true,
    lineageDerived: true,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "invalid-lineage-node");
});

test("Community: malformed contribution ids refuse before any domain call", async () => {
  const host = await createDesktopProductHost();
  const refused = host.community.command.dispatch({
    kind: "advance-contribution",
    tenant: host.viewer.tenant,
    actor: host.viewer.subject,
    contributionId: "not-a-content-address",
    command: "triage",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "invalid-intent");
});

test("the host's pinned identity is a valid game identity (what a git build injects)", () => {
  const identity = pinnedLocalProjectIdentity();
  assert.equal(isGameIdentity(identity), true);
  // The host's model route + role vocabulary stay opaque Lab handles.
  assert.ok(String(LOCAL_MODEL_ROUTE).length > 0);
  assert.equal(LOCAL_ROLE_VOCABULARY.length, 2);
});
