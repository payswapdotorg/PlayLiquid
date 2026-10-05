/**
 * Runtime self-check harness (PL-001 evidence).
 *
 * Run with: `node src/selfcheck.ts` (Node >= 24 type stripping).
 * Builds the fixture document, validates it, and prints deterministic
 * canonical forms, hashes and a determinism check. No assertions — those
 * live in tests.
 */

import { validate, countNodeKinds } from "./index.ts";
import { canonicalValueForm, hashGameIRValue, verifySimulationStepDeterminism } from "./index.ts";
import type { SimulationStep } from "./index.ts";
import { fixtureDocument } from "./fixtures.ts";

const document = fixtureDocument();
const result = validate(document);
console.log(`validate: ok=${result.ok} diagnostics=${result.diagnostics.length}`);
if (result.ok) {
  const counts = countNodeKinds(result.document);
  console.log(
    `nodes: world=${counts.world} scene=${counts.scene} entity=${counts.entity} rule=${counts.rule} event=${counts["event-declaration"]} capability=${counts["capability-declaration"]} avatar=${counts["avatar-binding"]}`,
  );
}

const state = { kind: "record", fields: { health: { kind: "int", value: 100n } } } as const;
console.log(`canonical: ${canonicalValueForm(state)}`);
console.log(`sha256:    ${hashGameIRValue(state)}`);

const step: SimulationStep = (input) => ({
  state: { kind: "record", fields: { moves: { kind: "int", value: BigInt(input.commands.length) } } },
  events: [],
});
console.log(`determinism: ${verifySimulationStepDeterminism(step, { state, commands: [] })}`);
