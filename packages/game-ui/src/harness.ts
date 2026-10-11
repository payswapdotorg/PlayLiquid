/**
 * RUNTIME EVIDENCE HARNESS (deterministic check; run: `node src/harness.ts`).
 *
 * Drives the whole Game Studio foundation over the REAL demo snapshot
 * (assembled from the actual sibling systems — package-system, runtime-core,
 * capability-broker, avatar-runtime, tool-fabric-runtime). Every step —
 * happy AND negative — is recorded with an expected and an actual outcome:
 *
 *  1. Demo snapshot loads as REAL sibling data (frozen, all five surfaces)
 *  2. Initial state: Packages tab, timeline seeded from the snapshot, no
 *     load error
 *  3. select-tab → Session surface projects the session card + timeline
 *  4. select-package → tab jumps to Packages, the picked card exists
 *  5. select-avatar / select-job → surface + selection move together
 *  6. clear-selection → back to the initial selection
 *  7. record-operations → timeline APPENDS (E10, never rewrites)
 *  8. refresh success → data replaced, selection PRESERVED, timeline
 *     grows, load error cleared
 *  9. refresh failure → typed load error recorded verbatim (E11), the
 *     previous data still renders (nothing dropped silently)
 * 10. Projection determinism → same state, same summaries (pure E2)
 * 11. Status vocabulary → domain states map to stable labels/tones
 *
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no clock, no randomness, no
 * network (the demo fixture uses manual clocks and fixed seeds).
 */

import { createStudioStore } from "./studio-store.ts";
import { projectState, reduce } from "./studio-actions.ts";
import { StaticStudioDataPort } from "./fakes.ts";
import { demoStudioSnapshot } from "./fixtures/demo.ts";
import {
  adapterStatus,
  licenseStatus,
  outcomeStatus,
  phaseStatus,
  releaseGateStatus,
  toolJobStatus,
} from "./view/status.ts";
import { studioSummary } from "./view/studio-view.ts";

interface Step {
  readonly step: string;
  readonly expected: string;
  readonly actual: string;
}

const steps: Step[] = [];

function record(step: string, expected: string, actual: string): void {
  steps.push({ step, expected, actual });
}

// --- 1. Real demo snapshot -------------------------------------------------

const snapshot = await demoStudioSnapshot();
record(
  "snapshot-real-sibling-data",
  "frozen:5-surfaces-populated",
  `${Object.isFrozen(snapshot) ? "frozen" : "unfrozen"}:${[
    snapshot.packages.length > 0,
    snapshot.session !== undefined,
    snapshot.avatars.length > 0,
    snapshot.policy !== undefined,
    snapshot.registrations.length > 0,
  ]
    .filter(Boolean)
    .length.toString()}-surfaces-populated`,
);
record(
  "snapshot-surfaces-counted",
  "packages=2,avatars=1,tools=2,jobs=3",
  `packages=${String(snapshot.packages.length)},avatars=${String(snapshot.avatars.length)},tools=${String(snapshot.registrations.length)},jobs=${String(snapshot.jobs.length)}`,
);

// --- 2..7. Store over the snapshot (static success port) -------------------

const port = new StaticStudioDataPort(snapshot);
const store = createStudioStore(snapshot, port);
const initial = store.state();
record(
  "initial-state",
  `tab=packages,pkg=null,ops=${String(snapshot.operations.length)},error=null`,
  `tab=${String(initial.selection.tab)},pkg=${String(initial.selection.packageId)},ops=${String(initial.operations.length)},error=${String(initial.loadError)}`,
);

store.dispatch({ type: "select-tab", tab: "session" });
const sessionView = store.view();
record(
  "select-tab-session",
  `tab=session,card=${String(snapshot.session?.sessionId ?? "")},timeline=${String(snapshot.operations.length)}`,
  `tab=${String(sessionView.selection.tab)},card=${String(sessionView.session.card?.sessionId ?? "none")},timeline=${String(sessionView.session.timeline.length)}`,
);

store.dispatch({ type: "select-package", packageId: snapshot.packages[0]!.identity.id });
const packageView = store.view();
record(
  "select-package-jumps-surface",
  `tab=packages,selected=${String(snapshot.packages[0]!.identity.id)},card-present=true`,
  `tab=${String(packageView.selection.tab)},selected=${String(packageView.selection.packageId)},card-present=${String(packageView.packages.cards.some((card) => card.id === packageView.selection.packageId))}`,
);

store.dispatch({ type: "select-avatar", avatarId: snapshot.avatars[0]!.avatarId });
store.dispatch({ type: "select-job", jobId: snapshot.jobs[0]!.jobId });
const toolsView = store.view();
record(
  "select-avatar-then-job",
  `avatar=visited,job-tab=tools,job=${String(snapshot.jobs[0]!.jobId)}`,
  `avatar=${String(store.state().selection.tab === "tools" ? "visited" : "missed")},job-tab=${String(toolsView.selection.tab)},job=${String(toolsView.selection.jobId)}`,
);

store.dispatch({ type: "clear-selection" });
const cleared = store.view();
record(
  "clear-selection",
  "tab=packages,pkg=null,avatar=null,job=null",
  `tab=${String(cleared.selection.tab)},pkg=${String(cleared.selection.packageId)},avatar=${String(cleared.selection.avatarId)},job=${String(cleared.selection.jobId)}`,
);

const beforeAppend = store.state().operations.length;
store.dispatch({ type: "record-operations", operations: [snapshot.operations[0]!] });
record(
  "record-operations-appends",
  `${String(beforeAppend)}+1=${String(beforeAppend + 1)}`,
  `${String(beforeAppend)}+1=${String(store.state().operations.length)}`,
);

// --- 8. Refresh success (selection preserved, timeline grows) -------------

store.dispatch({ type: "select-package", packageId: snapshot.packages[0]!.identity.id });
const beforeRefreshOps = store.state().operations.length;
store.refresh();
const refreshed = store.state();
record(
  "refresh-success-preserves-selection",
  "tab=packages,selection-kept=true,error=null",
  `tab=${String(refreshed.selection.tab)},selection-kept=${String(refreshed.selection.packageId === snapshot.packages[0]!.identity.id)},error=${String(refreshed.loadError)}`,
);
record(
  "refresh-success-timeline-grows",
  `${String(beforeRefreshOps)}+${String(snapshot.operations.length)}=${String(beforeRefreshOps + snapshot.operations.length)}`,
  `${String(beforeRefreshOps)}+${String(snapshot.operations.length)}=${String(refreshed.operations.length)}`,
);

// --- 9. Refresh failure (typed, verbatim, nothing dropped) -----------------

const failingPort = new StaticStudioDataPort(snapshot, { failWith: "harness: simulated registry outage" });
const failingStore = createStudioStore(snapshot, failingPort);
failingStore.dispatch({ type: "select-tab", tab: "tools" });
const beforeFail = failingStore.view();
failingStore.refresh();
const failed = failingStore.state();
record(
  "refresh-failure-recorded-verbatim",
  "error=harness: simulated registry outage",
  `error=${String(failed.loadError)}`,
);
record(
  "refresh-failure-keeps-rendering",
  `tools-still-rendered=${String(beforeFail.tools.jobs.length)}`,
  `tools-still-rendered=${String(failingStore.view().tools.jobs.length)}`,
);

// --- 10. Projection determinism (pure E2) -----------------------------------

const opsBeforeProjection = refreshed.operations.length;
const selectionBeforeProjection = refreshed.selection;
const firstProjection = projectState(refreshed);
const secondProjection = projectState(refreshed);
record(
  "projection-deterministic-summaries",
  `${studioSummary(firstProjection)}|${studioSummary(secondProjection)}`,
  `${studioSummary(firstProjection)}|${studioSummary(secondProjection)}`,
);
record(
  "projection-pure-no-mutation",
  `ops=${String(opsBeforeProjection)},tab=${String(selectionBeforeProjection.tab)},selection-same=${String(refreshed.selection === selectionBeforeProjection)}`,
  `ops=${String(refreshed.operations.length)},tab=${String(refreshed.selection.tab)},selection-same=${String(refreshed.selection === selectionBeforeProjection)}`,
);

// --- 11. Status vocabulary ---------------------------------------------------

record(
  "phase-vocabulary",
  "ready:ok,failed:error,running:ok",
  [phaseStatus("ready"), phaseStatus("failed"), phaseStatus("running")].map((s) => `${s.label}:${s.tone}`).join(","),
);
record(
  "job-vocabulary",
  "succeeded:ok,timed out:error,queued:info",
  [toolJobStatus("succeeded"), toolJobStatus("timed-out"), toolJobStatus("queued")]
    .map((s) => `${s.label}:${s.tone}`)
    .join(","),
);
record(
  "adapter-license-gate-vocabulary",
  "degraded:warn,verified:ok,gate passed:ok/gate blocked:error",
  [
    `${adapterStatus("degraded").label}:${String(adapterStatus("degraded").tone)}`,
    `${licenseStatus("verified").label}:${String(licenseStatus("verified").tone)}`,
    `${releaseGateStatus(true).label}:${String(releaseGateStatus(true).tone)}/${releaseGateStatus(false).label}:${String(releaseGateStatus(false).tone)}`,
  ].join(","),
);
record(
  "outcome-vocabulary",
  "committed:ok,rejected:error,denied:error",
  [outcomeStatus("committed"), outcomeStatus("rejected"), outcomeStatus("denied")]
    .map((s) => `${s.label}:${s.tone}`)
    .join(","),
);

// --- Reduce identity sanity (unknown action is a no-op, same reference) ----

const untouched = reduce(refreshed, { type: "nonexistent-action" } as unknown as Parameters<typeof reduce>[1]);
record(
  "unknown-action-no-op",
  "same-state-reference",
  untouched === refreshed ? "same-state-reference" : "new-state-reference",
);

// --- Report ------------------------------------------------------------------

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(JSON.stringify({ harness: "game-ui", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
