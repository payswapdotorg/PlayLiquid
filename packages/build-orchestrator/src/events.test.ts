/**
 * Append-only event log tests (E10): structural guard, corruption
 * detection over per-build sequences, and sequence minting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildPhase } from "@playliquid/build-contracts";
import { asBuildTargetId } from "@playliquid/build-contracts";
import {
  BUILD_EVENT_TYPES,
  BUILD_ORCHESTRATOR_AUTHORITY,
  findEventLogCorruption,
  isBuildEvent,
  nextSequence,
} from "./events.ts";
import type { BuildEvent, BuildEventType } from "./events.ts";
import { asTenantId } from "./tenancy.ts";

function event(over: Partial<BuildEvent> & { readonly buildId: string; readonly sequence: number }): BuildEvent {
  return {
    kind: "build-orchestrator-event",
    authority: BUILD_ORCHESTRATOR_AUTHORITY,
    tenant: asTenantId("tenant-a"),
    at: 1_000,
    type: "phase-transition",
    phase: "queued" as BuildPhase,
    ...over,
  };
}

test("the event type vocabulary is frozen and covers every transition", () => {
  assert.deepEqual([...BUILD_EVENT_TYPES], [
    "admitted",
    "phase-transition",
    "stage-completed",
    "build-succeeded",
    "build-failed",
    "build-cancelled",
    "limitation-recorded",
  ]);
});

test("a well-formed event passes the structural guard", () => {
  const candidate = event({ buildId: "bld-x", sequence: 1 });
  assert.equal(isBuildEvent(candidate), true);
});

test("structurally invalid events are refused by the guard", () => {
  assert.equal(isBuildEvent(null), false);
  assert.equal(isBuildEvent("phase-transition"), false);
  // Wrong kind / authority / sequence / type are all refused.
  assert.equal(isBuildEvent({ ...event({ buildId: "bld-x", sequence: 1 }), kind: "other" }), false);
  assert.equal(isBuildEvent({ ...event({ buildId: "bld-x", sequence: 1 }), authority: "someone-else" }), false);
  assert.equal(isBuildEvent(event({ buildId: "bld-x", sequence: 0 })), false);
  assert.equal(isBuildEvent(event({ buildId: "bld-x", sequence: 1.5 })), false);
  assert.equal(isBuildEvent({ ...event({ buildId: "bld-x", sequence: 1 }), type: "made-up" as BuildEventType }), false);
  assert.equal(isBuildEvent({ ...event({ buildId: "bld-x", sequence: 1 }), tenant: "" as never }), false);
});

test("a sound log (per-build sequences exactly 1, 2, 3, …) is not corrupt", () => {
  const log: readonly BuildEvent[] = [
    event({ buildId: "bld-a", sequence: 1 }),
    event({ buildId: "bld-b", sequence: 1 }),
    event({ buildId: "bld-a", sequence: 2 }),
    event({ buildId: "bld-b", sequence: 2 }),
  ];
  assert.equal(findEventLogCorruption(log), null);
});

test("sequence gaps and restarts are corrupt (append-only violation)", () => {
  const gap = findEventLogCorruption([
    event({ buildId: "bld-a", sequence: 1 }),
    event({ buildId: "bld-a", sequence: 3 }),
  ]);
  assert.notEqual(gap, null);
  if (gap !== null) {
    assert.equal(gap.buildId, "bld-a");
    assert.match(gap.message, /expected sequence 2/);
  }
  const restart = findEventLogCorruption([
    event({ buildId: "bld-a", sequence: 1 }),
    event({ buildId: "bld-a", sequence: 2 }),
    event({ buildId: "bld-a", sequence: 1 }),
  ]);
  assert.notEqual(restart, null);
  if (restart !== null) {
    assert.equal(restart.buildId, "bld-a");
    assert.match(restart.message, /append-only violation/);
  }
});

test("a structurally invalid entry is corrupt even with sound neighbours", () => {
  const corrupt = findEventLogCorruption([
    event({ buildId: "bld-a", sequence: 1 }),
    { ...event({ buildId: "bld-a", sequence: 2 }), authority: "not-the-owner" as typeof BUILD_ORCHESTRATOR_AUTHORITY },
  ]);
  assert.notEqual(corrupt, null);
  if (corrupt !== null) {
    assert.equal(corrupt.buildId, "bld-a");
    assert.match(corrupt.message, /structurally invalid/);
  }
});

test("nextSequence mints per-build, ignoring other builds' events", () => {
  const log: readonly BuildEvent[] = [
    event({ buildId: "bld-a", sequence: 1 }),
    event({ buildId: "bld-b", sequence: 1 }),
    event({ buildId: "bld-a", sequence: 2 }),
  ];
  assert.equal(nextSequence(log, "bld-a"), 3);
  assert.equal(nextSequence(log, "bld-b"), 2);
  assert.equal(nextSequence(log, "bld-unknown"), 1);
  assert.equal(nextSequence([], "bld-a"), 1);
});

test("the authority stamp is this service and never anything else", () => {
  assert.equal(BUILD_ORCHESTRATOR_AUTHORITY, "build-orchestrator");
  // Sanity: the stamp is usable against the frozen target vocabulary without
  // coupling (compile-time smoke for the re-exported branding).
  assert.equal(asBuildTargetId("web"), "web");
});
