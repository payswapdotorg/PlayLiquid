/**
 * BINDING TESTS (PL-039; §Runtime, lock rule 12) — the headless Simulation
 * Runtime binding: the blueprint equals the canonical streaming record, the
 * declared system order, the capability/intent bridge and the per-epoch
 * viewpoint grant.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJsonString, encodeGameIRValue, initialWorldState } from "../../../packages/simulation/src/index.ts";
import { COMMAND_KINDS, VIEWPOINT_CAPABILITY } from "./events.ts";
import { latticeDocument } from "./document.ts";
import { deriveWorldModel } from "./world-model.ts";
import { initialWorldRecord } from "./streaming.ts";
import { LATTICE_SYSTEM_IDS, buildLatticeBinding, latticeBlueprint, latticeSystems, viewpointGrant } from "./binding.ts";
import type { LatticeComposition } from "./composition.ts";
import { composeLatticeWorld } from "./composition.ts";

async function composed(): Promise<LatticeComposition> {
  const composition = await composeLatticeWorld();
  if (!composition.ok) throw new Error("canonical composition refused");
  return composition;
}

test("binding: the blueprint's initial state equals the canonical streaming record", async () => {
  const composition = await composed();
  const model = composition.model;
  const blueprint = latticeBlueprint(model);
  // The blueprint carries the viewpoint, the core flora and the two carriers.
  assert.equal(blueprint.entities.length, 1 + 3 + 2);
  const seeded = initialWorldState(blueprint);
  assert.equal(
    canonicalJsonString(encodeGameIRValue(seeded)),
    canonicalJsonString(encodeGameIRValue(initialWorldRecord(model))),
  );
  // buildLatticeBinding itself enforces the same invariant (fail closed).
  const binding = buildLatticeBinding(composition);
  assert.deepEqual(binding.blueprint, blueprint);
});

test("binding: the systems run in the declared order with unique ids", async () => {
  const composition = await composed();
  const systems = latticeSystems(composition.model, composition);
  assert.deepEqual(systems.map((system) => system.systemId), [...LATTICE_SYSTEM_IDS]);
  // The world identity + command policy + capability coverage travel with the binding.
  const binding = buildLatticeBinding(composition, { sessionId: "sess-binding-test" });
  assert.equal(String(binding.game.world.worldId), "world-lattice");
  assert.deepEqual(binding.commandPolicy[COMMAND_KINDS.viewMove], ["ready", "running"]);
  assert.equal(Object.keys(binding.capabilityIntentKinds).length, 1);
  assert.deepEqual(binding.capabilityIntentKinds[VIEWPOINT_CAPABILITY]?.map(String), [COMMAND_KINDS.viewMove]);
  assert.equal(binding.grants.length, 1);
});

test("binding: the viewpoint grant is host-issued, epoch-scoped and session-scoped", () => {
  const grant = viewpointGrant("sess-x", 3);
  assert.equal(grant.holder.actorClass, "avatar-agent");
  assert.equal(String(grant.holder.actorId), "actor-viewpoint");
  assert.equal(String(grant.capability), VIEWPOINT_CAPABILITY);
  assert.equal(String(grant.scope.sessionId), "sess-x");
  assert.equal(grant.epoch, 3);
  assert.equal(grant.issuedBy, "host-game-policy");
  assert.deepEqual(grant.constraints, []);
});

test("binding: the world model and document stay untouched by binding construction (static data)", async () => {
  const composition = await composed();
  const before = deriveWorldModel(latticeDocument());
  buildLatticeBinding(composition);
  assert.deepEqual(composition.model, before);
});
