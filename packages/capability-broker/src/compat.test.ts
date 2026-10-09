/**
 * COMPATIBILITY TESTS: the broker is wireable to runtime-core's
 * `CapabilityPort` seam AT COMPOSITION TIME without a package dependency.
 *
 * runtime-core (PL-013) is deliberately NOT a dependency of this package
 * (module matrix: capability-broker | game-ir + runtime-contracts). The
 * seam it froze — `CapabilityPort.evaluate(request, context)` over
 * `CapabilityPortContext {sessionId, epoch, tick}` — is satisfied
 * STRUCTURALLY by `CapabilityBroker.evaluate`. These tests keep the
 * structural mirrors honest: they re-declare the runtime-core interface
 * shapes verbatim (documented below) and assert assignability. If
 * runtime-core ever changes the seam, these mirrors must be updated and
 * the drift becomes visible here instead of at some host's composition
 * site.
 *
 * The same section proves `createGrantTableBroker` accepts the exact
 * options shape of runtime-core's `GrantTableCapabilityPort` fake
 * (`GrantTableOptions`), so test code written against the runtime-core
 * fake can be re-pointed at the real broker unchanged.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ActionRequest,
  ActionResolution,
  BudgetLedger,
  CapabilityGrant,
  IntentKind,
  SessionEpoch,
  SessionId,
  Tick,
  Timestamp,
} from "@playliquid/runtime-contracts";
import { CapabilityBroker } from "./broker.ts";
import { createGrantTableBroker, grantId, makeGrant, moveIntent } from "./fakes.ts";
import type { GrantTableCompatibleOptions } from "./fakes.ts";
import { asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";

/**
 * STRUCTURAL MIRROR of runtime-core's `CapabilityPortContext`
 * (packages/runtime-core/src/capability-port.ts). Kept verbatim.
 */
interface CapabilityPortContextMirror {
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
}

/**
 * STRUCTURAL MIRROR of runtime-core's `CapabilityPort`
 * (packages/runtime-core/src/capability-port.ts). Kept verbatim.
 */
interface CapabilityPortMirror {
  evaluate<P>(request: ActionRequest<P>, context: CapabilityPortContextMirror): ActionResolution<P>;
}

test("compat: CapabilityBroker satisfies the CapabilityPort seam structurally", () => {
  const broker = new CapabilityBroker({
    policy: {
      capabilityIntentKinds: {},
      intentCommandKinds: {},
      restrictions: { denied: [], approvalRequired: [] },
    },
    clock: { now: (): Timestamp => asTick(0) as never },
  });
  // The assignment compiles IFF the structural shape matches runtime-core's
  // frozen seam. This is the composition-time wiring proof (lock rule 4).
  const port: CapabilityPortMirror = broker;
  assert.equal(typeof port.evaluate, "function");
});

test("compat: the evaluation context is the port context shape", () => {
  const context = { sessionId: asSessionId("s"), epoch: asSessionEpoch(1), tick: asTick(1) };
  const portContext: CapabilityPortContextMirror = context;
  assert.deepEqual(portContext, context);
});

/**
 * STRUCTURAL MIRROR of runtime-core's `GrantTableOptions`
 * (packages/runtime-core/src/fakes.ts). Kept verbatim modulo the clock
 * interface name (both are `{ now(): Timestamp }`).
 */
interface GrantTableOptionsMirror {
  readonly grants?: readonly CapabilityGrant[];
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  readonly intentCommandKinds: Readonly<Record<string, string>>;
  readonly clock: { now(): Timestamp };
}

test("compat: any GrantTableOptions object is a createGrantTableBroker input", () => {
  const sessionId = asSessionId("s-compat");
  const options: GrantTableOptionsMirror = {
    grants: [makeGrant({ scope: { sessionId } })],
    capabilityIntentKinds: { "avatar.movement": ["move.to" as never] },
    intentCommandKinds: { "move.to": "world.move" },
    clock: { now: (): Timestamp => 0 as never },
  };
  // Assignment compiles IFF the shapes are compatible.
  const input: GrantTableCompatibleOptions = options;
  const broker = createGrantTableBroker(input);
  assert.equal(broker.grants.length, 1);
  const ledger: BudgetLedger = broker.ledger;
  assert.deepEqual(ledger, { consumed: {} });
});

test("compat: the GrantTable double evaluates like the runtime-core fake", () => {
  const sessionId = asSessionId("s-compat");
  const broker = createGrantTableBroker({
    grants: [makeGrant({ scope: { sessionId } })],
    capabilityIntentKinds: { "avatar.movement": ["move.to" as never] },
    intentCommandKinds: { "move.to": "world.move" },
    clock: { now: (): Timestamp => 10 as never },
  });
  const context = { sessionId, epoch: asSessionEpoch(1), tick: asTick(1) };
  const resolution = broker.evaluate(
    {
      requestId: "req-compat" as never,
      sessionId,
      actor: makeGrant().holder,
      intent: moveIntent(makeGrant().holder, "compat"),
      grantId: grantId("grant-1"),
      idempotencyKey: { scope: "action", actor: makeGrant().holder.actorId, nonce: "c1" as never },
    },
    context,
  );
  assert.equal(resolution.status, "granted");
  if (resolution.status === "granted") {
    assert.equal(String(resolution.command.commandId), "cmd-1", "deterministic cmd-<n> ids like the fake");
    assert.equal(String(resolution.command.kind), "world.move");
  }
  // The fake's API surface: issueGrant/revokeGrant/ledger. The broker's
  // equivalents are admit/revoke/ledger — capability-preserving mapping.
  const revoked: boolean = broker.revoke(grantId("grant-1"));
  assert.equal(revoked, true);
  assert.equal(broker.grants.length, 0);
});

test("compat: GrantTable options with a missing command mapping fail closed", () => {
  assert.throws(
    () =>
      createGrantTableBroker({
        capabilityIntentKinds: { "avatar.movement": ["move.to" as never] },
        intentCommandKinds: {},
        clock: { now: (): Timestamp => 0 as never },
      }),
    /has no command kind/,
    "an unmapped intent kind is a policy error, not a silent pass-through",
  );
});
