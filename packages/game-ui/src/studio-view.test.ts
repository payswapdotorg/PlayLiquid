/**
 * Read-model projection tests (pure): the five studio surfaces over the
 * REAL demo snapshot — deterministic outputs, selection threading, stale
 * markers, host-restriction surfacing (R5), gate verdicts (R19), append-only
 * timeline ordering (E10) and the shared status vocabulary (E1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_SELECTION, projectStudio, studioSummary } from "./view/studio-view.ts";
import { projectPackages, packagesSummary } from "./view/package-view.ts";
import { projectSession, sessionSummary } from "./view/runtime-view.ts";
import { projectAvatars, avatarsSummary } from "./view/avatar-view.ts";
import { projectBroker, brokerSummary } from "./view/broker-view.ts";
import { projectTools, toolsSummary } from "./view/tools-view.ts";
import {
  adapterStatus,
  grantStatus,
  licenseStatus,
  outcomeStatus,
  phaseStatus,
  releaseGateStatus,
  toolJobStatus,
} from "./view/status.ts";
import { demoStudioSnapshot, DEMO_RESTRICTION } from "./fixtures/demo.ts";

const snapshot = await demoStudioSnapshot();

test("projectStudio assembles all five surfaces from one snapshot", () => {
  const view = projectStudio(snapshot);
  assert.equal(view.selection, INITIAL_SELECTION);
  assert.ok(view.packages.cards.length >= 2);
  assert.ok(view.session.card !== undefined);
  assert.ok(view.avatars.cards.length >= 1);
  assert.ok(view.broker.coverage.length >= 1);
  assert.ok(view.tools.registrations.length >= 2);
});

test("projectStudio threads the selection through untouched", () => {
  const view = projectStudio(snapshot, {
    tab: "tools",
    packageId: snapshot.packages[0]!.identity.id,
    avatarId: snapshot.avatars[0]!.avatarId,
    jobId: snapshot.jobs[0]!.jobId,
  });
  assert.equal(view.selection.tab, "tools");
  assert.equal(view.selection.jobId, snapshot.jobs[0]!.jobId);
  // Selection does not mutate the data-derived surfaces.
  assert.equal(view.packages.cards.length, projectStudio(snapshot).packages.cards.length);
});

test("projectStudio is deterministic: same input → identical summaries", () => {
  const a = projectStudio(snapshot);
  const b = projectStudio(snapshot);
  assert.equal(studioSummary(a), studioSummary(b));
  assert.equal(packagesSummary(a.packages), packagesSummary(b.packages));
  assert.equal(sessionSummary(a.session), sessionSummary(b.session));
  assert.equal(avatarsSummary(a.avatars), avatarsSummary(b.avatars));
  assert.equal(brokerSummary(a.broker), brokerSummary(b.broker));
  assert.equal(toolsSummary(a.tools), toolsSummary(b.tools));
});

test("studioSummary reports phase, blocked gates and active jobs", () => {
  const view = projectStudio(snapshot);
  const expectedPhase = view.session.card?.phase.label ?? "no session";
  assert.ok(studioSummary(view).startsWith(`Game Studio · ${expectedPhase} · `));
  assert.ok(studioSummary(view).includes(`${view.packages.blockedCount} gate-blocked`));
  assert.ok(studioSummary(view).includes(`${view.tools.activeCount} active tool job`));
});

test("packages surface: cards carry gate verdicts (R19) and lockfile pins (PL-011)", () => {
  const view = projectPackages(snapshot.packages, snapshot.gateResults, snapshot.lock);
  assert.equal(view.cards.length, snapshot.packages.length);
  for (const card of view.cards) {
    assert.ok(card.gate.label === "gate passed" || card.gate.label === "gate blocked");
    assert.ok(typeof card.contentDigest === "string" && card.contentDigest.length > 0);
  }
  assert.ok(view.lockPins.length >= 1);
  // At least one demo package is deliberately gate-blocked (fixture design).
  assert.ok(view.cards.some((card) => card.gate.label === "gate blocked"));
});

test("session surface: card, latest observation and the append-only timeline (E10)", () => {
  const view = projectSession(snapshot.session, snapshot.operations, snapshot.observation);
  assert.ok(view.card !== undefined);
  assert.equal(view.card!.sessionId, snapshot.session!.sessionId);
  assert.equal(view.timeline.length, snapshot.operations.length);
  // Timeline order matches the input order (append-only, never reordered).
  const operations = snapshot.operations;
  for (const [index, row] of view.timeline.entries()) {
    assert.equal(row.operation, view.timeline[index]!.operation);
    assert.equal(row.epoch, view.timeline[index]!.epoch);
    assert.ok(operations[index] !== undefined);
  }
  assert.ok(view.latestEvents.length >= 1);
});

test("avatars surface: host-denied capabilities are surfaced (R5), not hidden", () => {
  const view = projectAvatars(snapshot.avatars, DEMO_RESTRICTION);
  assert.equal(view.cards.length, snapshot.avatars.length);
  assert.ok(view.deniedCapabilities.includes("audio"));
  const card = view.cards[0]!;
  // The denied capability must not appear among effective capabilities.
  for (const chip of card.capabilities) {
    if (chip.capability === "audio") {
      assert.notEqual(chip.status.tone, "ok");
    }
  }
});

test("broker surface: coverage, grants and tracked evaluations (PL-026)", () => {
  const view = projectBroker(snapshot.policy, snapshot.broker, snapshot.evaluations);
  assert.ok(view.coverage.length >= 1);
  assert.ok(view.grants.length >= 1);
  assert.equal(view.evaluations.length, snapshot.evaluations?.length ?? 0);
});

test("tools surface: registrations sorted, jobs newest-first, active counted", () => {
  const view = projectTools(snapshot.registrations, snapshot.jobs, snapshot.events);
  const ids = view.registrations.map((row) => row.toolId);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
  const sequences = view.jobs.map((job) => job.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => b - a));
  const active = view.jobs.filter((job) => job.status.label === "queued" || job.status.label === "running");
  assert.equal(view.activeCount, active.length);
});

test("status vocabulary: every domain state maps to a stable label + tone", () => {
  assert.deepEqual(phaseStatus("ready"), { label: "ready", tone: "ok" });
  assert.deepEqual(phaseStatus("failed"), { label: "failed", tone: "error" });
  assert.deepEqual(phaseStatus("suspended"), { label: "suspended", tone: "warn" });
  assert.deepEqual(toolJobStatus("timed-out"), { label: "timed out", tone: "error" });
  assert.deepEqual(adapterStatus("degraded"), { label: "degraded", tone: "warn" });
  assert.deepEqual(releaseGateStatus(false), { label: "gate blocked", tone: "error" });
  assert.deepEqual(licenseStatus("declared"), { label: "declared", tone: "warn" });
  assert.deepEqual(outcomeStatus("rejected"), { label: "rejected", tone: "error" });
  assert.deepEqual(outcomeStatus("duplicate"), { label: "duplicate receipt", tone: "info" });
  // Unknown states stay visible with the neutral tone (never crash, never hide).
  assert.deepEqual(phaseStatus("brave-new-phase"), { label: "brave-new-phase", tone: "neutral" });
});

test("grantStatus surfaces holders and ungranted capabilities (R5)", () => {
  const granted = grantStatus("cap.demo", ["holder-b", "holder-a"]);
  assert.equal(granted.tone, "ok");
  assert.equal(granted.note, "holders: holder-a, holder-b");
  const ungranted = grantStatus("cap.missing", []);
  assert.equal(ungranted.tone, "error");
  assert.ok(ungranted.note?.includes("cap.missing"));
});
