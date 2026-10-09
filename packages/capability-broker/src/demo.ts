/**
 * DEMO GAME FIXTURE (harness + tests): a fully VALID GameIR document
 * (validated by game-ir `validate`) plus the matching capability coverage
 * declaration the host game would hand the broker.
 *
 * The demo world has one rule per handled intent kind (`move.to`,
 * `speak.say`, `grasp.object`, `emit.signal`); the avatar binding for role
 * `companion` denies `sensory-output` (an actuator capability the host
 * refuses, R5) and puts `manipulation` behind host approval.
 *
 * Pure fixture module; no IO.
 */

import type { GameIRDocument, NodeId } from "@playliquid/game-ir";
import { validate } from "@playliquid/game-ir";
import { asSessionId } from "@playliquid/runtime-contracts";
import type { SessionId } from "@playliquid/runtime-contracts";
import type { CapabilityCoverageDeclaration } from "./policy.ts";
import { avatarActor, capId } from "./fakes.ts";

const SHA = "0123456789012345678901234567890123456789";

/** Nominal cast for node ids in the fixture (compile-time only). */
const nid = (text: string): NodeId => text as NodeId;

/** Demo session id used across the fixture helpers. */
export const DEMO_SESSION: SessionId = asSessionId("demo-session");

/** Demo avatar-agent actor. */
export const DEMO_ACTOR = avatarActor("demo-avatar");

/** The movement capability of the demo game. */
export const DEMO_MOVEMENT_CAPABILITY = capId("avatar.movement");

/** The speech capability of the demo game. */
export const DEMO_SPEECH_CAPABILITY = capId("avatar.speech");

/** The manipulation capability (approval-required in the demo binding). */
export const DEMO_MANIPULATION_CAPABILITY = capId("avatar.manipulation");

/** The sensory-output capability (denied outright in the demo binding). */
export const DEMO_SENSORY_OUTPUT_CAPABILITY = capId("avatar.sensory-output");

/** The demo game's GameIR document (valid; harness re-validates). */
export function demoGameDocument(): GameIRDocument {
  return {
    irVersion: "1",
    identity: {
      id: "demo-game" as never,
      displayName: "Capability Broker Demo Game",
      kind: "game",
      repository: { host: "github.example", owner: "playliquid", repository: "demo-game" },
      revision: { kind: "commit", commit: SHA as never },
      lineage: { head: SHA as never, ancestors: [] },
    },
    entry: { world: "demo-world" as never, scene: "scene-a" as never },
    nodes: [
      { id: nid("world-1"), kind: "world", world: "demo-world" as never, scenes: ["scene-a" as never] },
      {
        id: nid("scene-1"),
        kind: "scene",
        world: "demo-world" as never,
        scene: "scene-a" as never,
        entities: ["avatar-body" as never],
      },
      {
        id: nid("entity-1"),
        kind: "entity",
        scene: "scene-a" as never,
        entity: "avatar-body" as never,
        state: { kind: "unit" },
        behaviors: [nid("rule-movement"), nid("rule-speech"), nid("rule-manipulation"), nid("rule-signal")],
      },
      { id: nid("event-1"), kind: "event-declaration", eventType: "world.moved" as never, payload: { kind: "unit" } },
      { id: nid("event-2"), kind: "event-declaration", eventType: "avatar.spoke" as never, payload: { kind: "unit" } },
      { id: nid("event-3"), kind: "event-declaration", eventType: "avatar.grasped" as never, payload: { kind: "unit" } },
      { id: nid("event-4"), kind: "event-declaration", eventType: "avatar.signaled" as never, payload: { kind: "unit" } },
      {
        id: nid("rule-movement"),
        kind: "rule",
        on: ["world.moved" as never],
        handles: ["move.to" as never],
        emits: ["world.moved" as never],
      },
      {
        id: nid("rule-speech"),
        kind: "rule",
        on: ["avatar.spoke" as never],
        handles: ["speak.say" as never],
        emits: ["avatar.spoke" as never],
      },
      {
        id: nid("rule-manipulation"),
        kind: "rule",
        on: ["avatar.grasped" as never],
        handles: ["grasp.object" as never],
        emits: ["avatar.grasped" as never],
      },
      {
        id: nid("rule-signal"),
        kind: "rule",
        on: ["avatar.signaled" as never],
        handles: ["emit.signal" as never],
        emits: ["avatar.signaled" as never],
      },
      {
        id: nid("binding-companion"),
        kind: "avatar-binding",
        role: "companion",
        restrictions: {
          denied: ["sensory-output"],
          approvalRequired: ["manipulation"],
          sandboxed: false,
        },
      },
    ],
  };
}

/** Coverage declaration matching the demo document's rules. */
export function demoCoverage(): readonly CapabilityCoverageDeclaration[] {
  return [
    {
      capability: DEMO_MOVEMENT_CAPABILITY,
      intentKinds: ["move.to"],
      commandKindByIntent: { "move.to": "world.move" },
    },
    {
      capability: DEMO_SPEECH_CAPABILITY,
      intentKinds: ["speak.say"],
      commandKindByIntent: { "speak.say": "avatar.speak" },
    },
    {
      capability: DEMO_MANIPULATION_CAPABILITY,
      intentKinds: ["grasp.object"],
      commandKindByIntent: { "grasp.object": "avatar.grasp" },
    },
    {
      capability: DEMO_SENSORY_OUTPUT_CAPABILITY,
      intentKinds: ["emit.signal"],
      commandKindByIntent: { "emit.signal": "avatar.emit-signal" },
    },
  ];
}

/** Assert-once helper: the demo document must validate cleanly. */
export function assertDemoDocumentValid(): void {
  const result = validate(demoGameDocument());
  if (!result.ok) {
    throw new Error(
      `demo GameIR document failed validation: ${result.diagnostics.map((d) => d.message).join("; ")}`,
    );
  }
}
