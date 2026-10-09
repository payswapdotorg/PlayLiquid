/**
 * Codec tests: GameIRValue ⇄ JSON-safe round-trip under game-ir's frozen
 * canonicalization rules (bigint ints, canonical floats, -0 vs +0, NaN,
 * sorted record keys) and byte-stable canonical JSON.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalValueForm } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import { asEntityId, asSceneId, asWorldId } from "@playliquid/game-contracts";
import { canonicalJsonString, decodeGameIRValue, encodeGameIRValue } from "./codec.ts";

const ref = {
  world: asWorldId("world-primus")!,
  scene: asSceneId("scene-overworld")!,
  entity: asEntityId("entity-hero")!,
};

function roundTrips(value: GameIRValue): void {
  const encoded = encodeGameIRValue(value);
  const decoded = decodeGameIRValue(encoded);
  assert.equal(canonicalValueForm(decoded), canonicalValueForm(value));
}

test("codec: every value kind round-trips under canonical equality", () => {
  roundTrips({ kind: "unit" });
  roundTrips({ kind: "bool", value: true });
  roundTrips({ kind: "int", value: 123456789012345678901234567890n });
  roundTrips({ kind: "int", value: -42n });
  roundTrips({ kind: "float", value: 1.5 });
  roundTrips({ kind: "float", value: -0 });
  roundTrips({ kind: "float", value: 0 });
  roundTrips({ kind: "float", value: Number.NaN });
  roundTrips({ kind: "float", value: Number.POSITIVE_INFINITY });
  roundTrips({ kind: "float", value: Number.NEGATIVE_INFINITY });
  roundTrips({ kind: "string", value: "hero café \u{1F600}" });
  roundTrips({ kind: "list", items: [{ kind: "int", value: 1n }, { kind: "string", value: "x" }] });
  roundTrips({
    kind: "record",
    fields: {
      z: { kind: "int", value: 1n },
      a: { kind: "bool", value: false },
      nested: { kind: "list", items: [{ kind: "float", value: -0 }] },
    },
  });
  roundTrips({ kind: "entity-ref", ref });
});

test("codec: -0 and +0 stay distinct (game-ir frozen rule)", () => {
  const minus = decodeGameIRValue(encodeGameIRValue({ kind: "float", value: -0 }));
  const plus = decodeGameIRValue(encodeGameIRValue({ kind: "float", value: 0 }));
  assert.equal(Object.is(minus.kind === "float" ? minus.value : undefined, -0), true);
  assert.equal(canonicalValueForm(minus), "f(-0)");
  assert.equal(canonicalValueForm(plus), "f(0)");
  assert.notEqual(canonicalValueForm(minus), canonicalValueForm(plus));
});

test("codec: record field order never matters for the canonical bytes", () => {
  const first: GameIRValue = {
    kind: "record",
    fields: { a: { kind: "int", value: 1n }, b: { kind: "int", value: 2n } },
  };
  const second: GameIRValue = {
    kind: "record",
    fields: { b: { kind: "int", value: 2n }, a: { kind: "int", value: 1n } },
  };
  assert.equal(canonicalJsonString(encodeGameIRValue(first)), canonicalJsonString(encodeGameIRValue(second)));
});

test("codec: canonical JSON is byte-stable across constructions", () => {
  const build = (): string =>
    canonicalJsonString(
      encodeGameIRValue({
        kind: "record",
        fields: {
          position: { kind: "list", items: [{ kind: "float", value: 1.25 }, { kind: "float", value: 2.5 }] },
          health: { kind: "int", value: 12n },
        },
      }),
    );
  assert.equal(build(), build());
  assert.equal(build(), build());
});

test("codec: decoding garbage fails closed", () => {
  assert.throws(() => decodeGameIRValue("nope" as never));
  assert.throws(() => decodeGameIRValue({ k: "int", v: "not-a-number" }));
  assert.throws(() => decodeGameIRValue({ k: "unknown" }));
  assert.throws(() => decodeGameIRValue({ k: "bool", v: "yes" }));
  assert.throws(() => decodeGameIRValue({ k: "eref", w: 1, s: 2, e: 3 }));
});

test("codec: non-finite numbers are rejected by canonical JSON", () => {
  assert.throws(() => canonicalJsonString([Number.NaN]));
  assert.throws(() => canonicalJsonString([Number.POSITIVE_INFINITY]));
});
