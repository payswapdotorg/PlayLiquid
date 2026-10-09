/**
 * Module role: tests for the job model — typed status transitions,
 * terminal statuses, job request validation and stored snapshot/record
 * validation (restore path).
 *
 * Implements: PL-019 job model behavior coverage (E6 shapes).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advanceToolJobStatus,
  isToolJobTerminal,
  validateJobStoreRecord,
  validateToolJobRequest,
  validateToolJobSnapshot,
  type ToolJobStatus,
} from "./domain/job.ts";

const sampleCall = {
  kind: "tool-call-request",
  callId: "call-1",
  tool: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 0 },
  input: { count: 2, sides: 6 },
  requiredCapabilities: ["random.generate"],
};

const sampleSnapshot = {
  kind: "tool-job-snapshot",
  jobId: "job-1",
  callId: "call-1",
  tool: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 0 },
  input: { count: 2, sides: 6 },
  requiredCapabilities: ["random.generate"],
  status: "succeeded",
  attempts: 1,
  maxAttempts: 1,
  cancellationRequested: false,
  queuedAt: 10,
  sequence: 3,
};

test("advanceToolJobStatus allows only the binding transitions", () => {
  assert.deepEqual(advanceToolJobStatus("queued", "running"), { outcome: "ok", next: "running" });
  assert.deepEqual(advanceToolJobStatus("queued", "cancelled"), { outcome: "ok", next: "cancelled" });
  assert.deepEqual(advanceToolJobStatus("running", "queued"), { outcome: "ok", next: "queued" });
  for (const terminal of ["succeeded", "failed", "timed-out", "cancelled"] as ToolJobStatus[]) {
    for (const target of ["queued", "running", "succeeded", "failed", "timed-out", "cancelled"] as ToolJobStatus[]) {
      const check = advanceToolJobStatus(terminal, target);
      if (check.outcome !== "rejected") {
        assert.fail(`terminal ${terminal} must never transition to ${target}`);
      }
      assert.equal(check.code, "job/terminal-status");
    }
  }
  const bad = advanceToolJobStatus("queued", "succeeded");
  if (bad.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(bad.code, "job/invalid-transition");
  const bogus = advanceToolJobStatus("queued", "bogus" as ToolJobStatus);
  if (bogus.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(bogus.code, "job/unknown-status");
});

test("isToolJobTerminal marks exactly the terminal statuses", () => {
  assert.equal(isToolJobTerminal("queued"), false);
  assert.equal(isToolJobTerminal("running"), false);
  assert.equal(isToolJobTerminal("succeeded"), true);
  assert.equal(isToolJobTerminal("failed"), true);
  assert.equal(isToolJobTerminal("timed-out"), true);
  assert.equal(isToolJobTerminal("cancelled"), true);
});

test("validateToolJobRequest accepts a full request and defaults maxAttempts to 1", () => {
  const check = validateToolJobRequest({ jobId: "job-1", call: sampleCall });
  if (check.outcome !== "ok") {
    assert.fail(check.rejections.map((item) => item.message).join("; "));
  }
  assert.equal(check.maxAttempts, 1);
  assert.equal(check.call.callId, "call-1");

  const withRetry = validateToolJobRequest({ jobId: "job-1", call: sampleCall, maxAttempts: 3 });
  if (withRetry.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.equal(withRetry.maxAttempts, 3);
});

test("validateToolJobRequest rejects invalid job ids, calls and attempt bounds", () => {
  const noId = validateToolJobRequest({ call: sampleCall });
  if (noId.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(noId.rejections[0]?.code, "job/job-id-missing");

  const badCall = validateToolJobRequest({ jobId: "job-1", call: { kind: "tool-call-request" } });
  if (badCall.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badCall.rejections[0]?.code, "job/call-invalid");

  assert.equal(validateToolJobRequest(null).outcome, "rejected");
  for (const maxAttempts of [0, -1, 9, 1.5]) {
    const bad = validateToolJobRequest({ jobId: "job-1", call: sampleCall, maxAttempts });
    if (bad.outcome !== "rejected") {
      assert.fail(`maxAttempts ${maxAttempts} must be rejected`);
    }
    assert.equal(bad.rejections.some((item) => item.code === "job/max-attempts-invalid"), true);
  }
});

test("validateToolJobSnapshot accepts a well-formed snapshot", () => {
  const check = validateToolJobSnapshot(sampleSnapshot);
  if (check.outcome !== "ok") {
    assert.fail(check.rejections.map((item) => item.message).join("; "));
  }
  assert.equal(check.snapshot.status, "succeeded");
  assert.equal(check.snapshot.sequence, 3);
});

test("validateToolJobSnapshot rejects corrupt snapshots with typed codes", () => {
  const badStatus = validateToolJobSnapshot({ ...sampleSnapshot, status: "done" });
  if (badStatus.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(badStatus.rejections.some((item) => item.code === "snapshot/status-invalid"));

  const badAttempts = validateToolJobSnapshot({ ...sampleSnapshot, attempts: -2 });
  if (badAttempts.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(badAttempts.rejections.some((item) => item.code === "snapshot/attempts-invalid"));

  const badCapabilities = validateToolJobSnapshot({ ...sampleSnapshot, requiredCapabilities: [1] });
  if (badCapabilities.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(badCapabilities.rejections.some((item) => item.code === "snapshot/capabilities-invalid"));

  assert.equal(validateToolJobSnapshot("nope").outcome, "rejected");
});

test("validateJobStoreRecord validates the record and its recorded outcome", () => {
  const ok = validateJobStoreRecord({ job: sampleSnapshot });
  if (ok.outcome !== "ok") {
    assert.fail(ok.rejections.map((item) => item.message).join("; "));
  }
  assert.equal(ok.record.outcome, undefined);

  const badOutcome = validateJobStoreRecord({ job: sampleSnapshot, outcome: { outcome: "weird" } });
  if (badOutcome.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badOutcome.rejections[0]?.code, "record/outcome-invalid");

  const badJob = validateJobStoreRecord({ job: null });
  if (badJob.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badJob.rejections[0]?.code, "record/job-invalid");
});
