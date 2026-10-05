import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  ANALYTICS_PRIVACY_CLASSES,
  ANALYTICS_FORBIDDEN_PAYLOAD_KEYS,
  isForbiddenAnalyticsPayloadKey,
  isAnalyticsServicePolicy,
  isAnalyticsEventBinding,
  ingestAnalyticsBatch,
} from "./analytics.ts";
import type {
  AnalyticsServicePolicy,
  AnalyticsEventBinding,
  AnalyticsEventRecord,
} from "./analytics.ts";

const subject = asSubjectId("player-one")!;
const sessionStart = asGameEventKind("session.started")!;
const shotLanded = asGameEventKind("shot.landed")!;

const policy: AnalyticsServicePolicy = { maxEventsPerBatch: 10, defaultRetentionDays: 90 };

const declared: readonly AnalyticsEventBinding[] = [
  { capability: "analytics", eventKind: sessionStart, privacy: "pseudonymous", retentionDays: 90 },
  { capability: "analytics", eventKind: shotLanded, privacy: "anonymous", retentionDays: 30 },
];

function record(overrides: Partial<AnalyticsEventRecord>): AnalyticsEventRecord {
  const full: AnalyticsEventRecord = {
    eventKind: sessionStart,
    privacy: "pseudonymous",
    subject,
    payload: { duration: 42 },
  };
  return { ...full, ...overrides };
}

test("analytics: privacy classes and forbidden keys are frozen vocabularies", () => {
  assert.ok(Object.isFrozen(ANALYTICS_PRIVACY_CLASSES));
  assert.ok(Object.isFrozen(ANALYTICS_FORBIDDEN_PAYLOAD_KEYS));
  assert.deepEqual([...ANALYTICS_PRIVACY_CLASSES], ["anonymous", "pseudonymous", "identified"]);
  assert.ok(isForbiddenAnalyticsPayloadKey("credentials"));
  assert.ok(isForbiddenAnalyticsPayloadKey("apikey"));
  assert.equal(isForbiddenAnalyticsPayloadKey("duration"), false);
});

test("analytics: service policies and event bindings validate", () => {
  assert.ok(isAnalyticsServicePolicy(policy));
  assert.equal(isAnalyticsServicePolicy({ ...policy, maxEventsPerBatch: 0 }), false);
  assert.equal(isAnalyticsServicePolicy({ ...policy, maxEventsPerBatch: 1001 }), false);
  assert.ok(isAnalyticsEventBinding(declared[0]!));
  assert.equal(
    isAnalyticsEventBinding({ capability: "analytics", eventKind: sessionStart, privacy: "secret", retentionDays: 90 }),
    false,
  );
  assert.equal(
    isAnalyticsEventBinding({ capability: "analytics", eventKind: sessionStart, privacy: "anonymous", retentionDays: 0 }),
    false,
  );
});

test("analytics: declared, privacy-matching records are accepted", () => {
  const receipt = ingestAnalyticsBatch({ events: [record({})] }, declared, policy);
  assert.deepEqual(receipt, { acceptedCount: 1, rejected: [] });
});

test("analytics: undeclared event kinds are rejected per record (E8)", () => {
  const receipt = ingestAnalyticsBatch(
    { events: [record({ eventKind: asGameEventKind("telemetry.secret")! })] },
    declared,
    policy,
  );
  assert.deepEqual(receipt, { acceptedCount: 0, rejected: [{ index: 0, code: "undeclared-event-kind" }] });
});

test("analytics: privacy class mismatches are rejected (E8)", () => {
  const receipt = ingestAnalyticsBatch(
    { events: [record({ eventKind: shotLanded, privacy: "pseudonymous" })] },
    declared,
    policy,
  );
  assert.deepEqual(receipt, { acceptedCount: 0, rejected: [{ index: 0, code: "privacy-mismatch" }] });
});

test("analytics: anonymous events must not carry subjects (E8)", () => {
  const receipt = ingestAnalyticsBatch(
    { events: [record({ eventKind: shotLanded, privacy: "anonymous", subject: undefined, payload: {} })] },
    declared,
    policy,
  );
  assert.deepEqual(receipt, { acceptedCount: 1, rejected: [] });
  const withSubject = ingestAnalyticsBatch(
    { events: [record({ eventKind: shotLanded, privacy: "anonymous", payload: {} })] },
    declared,
    policy,
  );
  assert.deepEqual(withSubject, { acceptedCount: 0, rejected: [{ index: 0, code: "subject-on-anonymous" }] });
});

test("analytics: credential-shaped payload keys are never admissible (E8/E3)", () => {
  const receipt = ingestAnalyticsBatch(
    { events: [record({ payload: { credentials: "assembled-at-runtime" } })] },
    declared,
    policy,
  );
  assert.deepEqual(receipt, { acceptedCount: 0, rejected: [{ index: 0, code: "forbidden-payload-key" }] });
  const tokenReceipt = ingestAnalyticsBatch(
    { events: [record({ payload: { token: "fragment-one" } })] },
    declared,
    policy,
  );
  assert.deepEqual(tokenReceipt, { acceptedCount: 0, rejected: [{ index: 0, code: "forbidden-payload-key" }] });
});

test("analytics: oversized batches are refused wholesale, never partially ingested (E8)", () => {
  const events = Array.from({ length: 11 }, () => record({}));
  const receipt = ingestAnalyticsBatch({ events }, declared, policy);
  assert.deepEqual(receipt, { acceptedCount: 0, rejected: [] });
});

test("analytics: mixed batches accept the good and type the bad", () => {
  const receipt = ingestAnalyticsBatch(
    {
      events: [
        record({}),
        record({ eventKind: asGameEventKind("telemetry.other")! }),
        record({ payload: { password: "x" } }),
        record({ eventKind: shotLanded, privacy: "anonymous", subject: undefined, payload: {} }),
      ],
    },
    declared,
    policy,
  );
  assert.equal(receipt.acceptedCount, 2);
  assert.deepEqual(receipt.rejected, [
    { index: 1, code: "undeclared-event-kind" },
    { index: 2, code: "forbidden-payload-key" },
  ]);
});
