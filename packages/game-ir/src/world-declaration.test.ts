import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, validationErrors, isGameIRDocument } from "./validate.ts";
import type { GameIRDocument } from "./document.ts";
import type { GameIRNode } from "./nodes.ts";
import { fixtureDocument } from "./fixtures.ts";
import {
  WORLD_KINDS,
  TARGET_PROFILES,
  DEFAULT_WORLD_KIND,
  isWorldDeclaration,
  resolveWorldKind,
} from "@playliquid/game-contracts";

/**
 * ACR-001 Phase B (PLX-ARCH-002) migration/compatibility tests: the optional
 * document-level `world` declaration. Absence is the legacy default (kind
 * `game`, profile unspecified) and stays valid; the two dimensions are
 * independent; unknown values are rejected with the typed codes; and the
 * registries are imported from the single definition site
 * (@playliquid/game-contracts) — never re-declared here.
 */

function withWorld(world: unknown): unknown {
  const document = fixtureDocument() as GameIRDocument & { world?: unknown };
  if (world === undefined) {
    delete document.world;
  } else {
    (document as { world?: unknown }).world = world;
  }
  return document;
}

function codesOf(result: ReturnType<typeof validate>): string[] {
  assert.equal(result.ok, false, "expected validation to fail");
  return validationErrors(result).map((diagnostic) => diagnostic.code);
}

test("world declaration: absent means the legacy default and stays valid (no diagnostic for absence)", () => {
  const result = validate(withWorld(undefined));
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(isGameIRDocument(withWorld(undefined)));
  if (result.ok) {
    assert.equal(resolveWorldKind(result.document.world), "game");
  }
});

test("world declaration: every legal combination validates — kind and profile are independent dimensions", () => {
  for (const kind of WORLD_KINDS) {
    for (const profile of [undefined, ...TARGET_PROFILES]) {
      const world = profile === undefined ? { kind } : { kind, targetProfile: profile };
      const result = validate(withWorld(world));
      assert.equal(result.ok, true, JSON.stringify(world));
      assert.ok(isWorldDeclaration(world), JSON.stringify(world));
    }
  }
  for (const profile of TARGET_PROFILES) {
    const result = validate(withWorld({ targetProfile: profile }));
    assert.equal(result.ok, true, JSON.stringify({ targetProfile: profile }));
  }
  assert.equal(validate(withWorld({})).ok, true);
});

test("world declaration: a spark-kind World with a non-spark profile and a game-kind World with spark_vertical both validate", () => {
  assert.equal(validate(withWorld({ kind: "spark", targetProfile: "xr" })).ok, true);
  assert.equal(validate(withWorld({ kind: "game", targetProfile: "spark_vertical" })).ok, true);
  assert.equal(validate(withWorld({ kind: "digital_twin", targetProfile: "simulation" })).ok, true);
});

test("world declaration: unknown kinds fail with GAMEIR/E019", () => {
  for (const invalid of ["sparkk", "SPARK", "short", 42, null]) {
    const result = validate(withWorld({ kind: invalid }));
    assert.ok(codesOf(result).includes("GAMEIR/E019"), `kind ${JSON.stringify(invalid)}`);
  }
});

test("world declaration: unknown target profiles fail with GAMEIR/E020", () => {
  for (const invalid of ["9:16", "vertical_spark", "web ", "WEB", 42, null]) {
    const result = validate(withWorld({ targetProfile: invalid }));
    assert.ok(codesOf(result).includes("GAMEIR/E020"), `profile ${JSON.stringify(invalid)}`);
  }
});

test("world declaration: non-objects fail with GAMEIR/E017", () => {
  for (const invalid of [null, 42, "spark", [ { kind: "spark" } ]]) {
    const result = validate(withWorld(invalid));
    assert.ok(codesOf(result).includes("GAMEIR/E017"), JSON.stringify(invalid));
  }
});

test("world declaration: unknown declaration keys fail with GAMEIR/E017", () => {
  const result = validate(withWorld({ kind: "spark", mode: "build" }));
  assert.ok(codesOf(result).includes("GAMEIR/E017"));
  assert.equal(isWorldDeclaration({ kind: "spark", mode: "build" }), false);
});

test("world declaration: unknown kind AND unknown profile collect both diagnostics (not fail-fast)", () => {
  const result = validate(withWorld({ kind: "sparkk", targetProfile: "9:16" }));
  const codes = codesOf(result);
  assert.ok(codes.includes("GAMEIR/E019"));
  assert.ok(codes.includes("GAMEIR/E020"));
});

test("world declaration: the fixture document gains a declaration without touching nodes (additive-only regression)", () => {
  const before: readonly GameIRNode[] = fixtureDocument().nodes;
  const withDeclaration = withWorld({ kind: "spark", targetProfile: "spark_vertical" });
  const result = validate(withDeclaration);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.document.nodes.length, before.length);
    assert.deepEqual(result.document.world, { kind: "spark", targetProfile: "spark_vertical" });
    assert.equal(resolveWorldKind(result.document.world), "spark");
  }
});

test("world declaration: the registries come from the single definition site — never re-declared in GameIR", () => {
  assert.equal(DEFAULT_WORLD_KIND, "game");
  assert.deepEqual(WORLD_KINDS, ["spark", "game", "experience", "digital_twin", "other"]);
  assert.deepEqual(TARGET_PROFILES, [
    "spark_vertical",
    "web",
    "desktop",
    "mobile",
    "xr",
    "dedicated_server",
    "simulation",
  ]);
});
