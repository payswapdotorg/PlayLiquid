import { test } from "node:test";
import assert from "node:assert/strict";
import { countNodeKinds, isGameIRDocument, validate, validationErrors } from "./validate.ts";
import type { GameIRDocument } from "./document.ts";
import { fixtureDocument } from "./fixtures.ts";

function expectCodes(result: ReturnType<typeof validate>): string[] {
  assert.equal(result.ok, false, "expected validation to fail");
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}

function mutate(fn: (document: GameIRDocument) => void): unknown {
  const document = fixtureDocument();
  fn(document);
  return document;
}

test("validate: the fixture document round-trips green", () => {
  const result = validate(fixtureDocument());
  assert.equal(result.ok, true);
  assert.ok(isGameIRDocument(fixtureDocument()));
  if (result.ok) {
    assert.equal(result.document.irVersion, "1");
    assert.equal(countNodeKinds(result.document).rule, 1);
    assert.equal(validationErrors(result).length, 0);
  }
});

test("validate: non-objects fail with E001", () => {
  for (const input of [null, undefined, 42, "doc", true, []]) {
    const result = validate(input);
    assert.deepEqual(expectCodes(result), ["GAMEIR/E001"], `input ${String(input)}`);
  }
});

test("validate: unsupported versions fail with E002", () => {
  const result = validate(mutate((document) => ((document as { irVersion: string }).irVersion = "2")));
  assert.ok(expectCodes(result).includes("GAMEIR/E002"));
});

test("validate: broken identity fails with E003", () => {
  const result = validate(mutate((document) => ((document.identity as { displayName: string }).displayName = "")));
  assert.ok(expectCodes(result).includes("GAMEIR/E003"));
});

test("validate: non-array nodes fail with E004", () => {
  const result = validate(mutate((document) => ((document as { nodes: unknown }).nodes = {})));
  assert.ok(expectCodes(result).includes("GAMEIR/E004"));
});

test("validate: unknown node kinds fail with E005", () => {
  const result = validate(mutate((document) => ((document.nodes[0] as { kind: string }).kind = "quantum")));
  assert.ok(expectCodes(result).includes("GAMEIR/E005"));
  const notAnObject = validate(mutate((document) => ((document as { nodes: unknown }).nodes = [42])));
  assert.ok(expectCodes(notAnObject).includes("GAMEIR/E005"));
});

test("validate: duplicate node ids fail with E006", () => {
  const result = validate(
    mutate((document) => {
      const scene = document.nodes[1];
      if (scene !== undefined && scene.kind === "scene") {
        (scene as { id: string }).id = "world-primus-node";
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E006"));
});

test("validate: unresolved entry scene fails with E007", () => {
  const result = validate(
    mutate((document) => ((document.entry as { scene: string }).scene = "scene-unknown")),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E007"));
});

test("validate: entity in undeclared scene fails with E008", () => {
  const result = validate(
    mutate((document) => {
      const entity = document.nodes[2];
      if (entity !== undefined && entity.kind === "entity") {
        (entity as unknown as { scene: string }).scene = "scene-unknown";
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E008"));
});

test("validate: rule referencing undeclared event fails with E009", () => {
  const result = validate(
    mutate((document) => {
      const rule = document.nodes[3];
      if (rule !== undefined && rule.kind === "rule") {
        (rule as unknown as { on: string[] }).on = ["world.entity.ghosted"];
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E009"));
});

test("validate: broken capability declaration fails with E010", () => {
  const result = validate(
    mutate((document) => {
      const capability = document.nodes[6];
      if (capability !== undefined && capability.kind === "capability-declaration") {
        (capability as unknown as { requirement: unknown }).requirement = {
          capability: "replay",
          required: true,
          policy: { capture: "telepathy" },
        };
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E010"));
});

test("validate: broken avatar binding fails with E011", () => {
  const result = validate(
    mutate((document) => {
      const binding = document.nodes[7];
      if (binding !== undefined && binding.kind === "avatar-binding") {
        (binding as unknown as { restrictions: unknown }).restrictions = { denied: ["flight"] };
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E011"));
});

test("validate: broken entity state fails with E012", () => {
  const result = validate(
    mutate((document) => {
      const entity = document.nodes[2];
      if (entity !== undefined && entity.kind === "entity") {
        (entity as unknown as { state: unknown }).state = { kind: "int", value: 1 };
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E012"));
});

test("validate: broken spatial descriptor fails with E013", () => {
  const result = validate(
    mutate((document) => {
      const world = document.nodes[0];
      if (world !== undefined && world.kind === "world") {
        (world as unknown as { partitioning: unknown }).partitioning = { scheme: "uniform-grid", cellSize: [0, 8, 8] };
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E013"));
});

test("validate: scene in undeclared world fails with E014", () => {
  const result = validate(
    mutate((document) => {
      const scene = document.nodes[1];
      if (scene !== undefined && scene.kind === "scene") {
        (scene as unknown as { world: string }).world = "world-other";
      }
    }),
  );
  assert.ok(expectCodes(result).includes("GAMEIR/E014"));
});

test("validate: invalid lifecycle state fails with E015", () => {
  const result = validate(mutate((document) => ((document as { lifecycle: string }).lifecycle = "live")));
  assert.ok(expectCodes(result).includes("GAMEIR/E015"));
});

test("validate: invalid entry ref fails with E016", () => {
  const result = validate(mutate((document) => ((document.entry as { world: string }).world = "NOT-A-SLUG")));
  assert.ok(expectCodes(result).includes("GAMEIR/E016"));
});

test("validate: unused event declaration is a warning, not an error", () => {
  const result = validate(
    mutate((document) => {
      const rule = document.nodes[3];
      if (rule !== undefined && rule.kind === "rule") {
        (rule as unknown as { on: string[]; emits: string[] }).on = ["world.entity.moved"];
        (rule as unknown as { emits: string[] }).emits = ["world.entity.moved"];
      }
    }),
  );
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.diagnostics));
  if (result.ok) {
    assert.deepEqual(result.diagnostics.map((d) => d.code), ["GAMEIR/W001"]);
  }
});

test("validate: behavior-less entity is a warning, not an error", () => {
  const result = validate(
    mutate((document) => {
      const entity = document.nodes[2];
      if (entity !== undefined && entity.kind === "entity") {
        (entity as unknown as { behaviors: string[] }).behaviors = [];
      }
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.diagnostics.some((d) => d.code === "GAMEIR/W002"));
  }
});

test("validate: never throws on hostile input (E018 safety net)", () => {
  const circular: Record<string, unknown> = { irVersion: "1" };
  circular.self = circular;
  const results = [
    validate(circular),
    validate({ ...fixtureDocument(), nodes: [{ ...circular }] }),
    validate(new Date()),
  ];
  for (const result of results) {
    assert.notEqual(result.ok, null);
    assert.equal(typeof result.ok, "boolean");
  }
  let deepValue: unknown = { kind: "unit" };
  for (let index = 0; index < 1000; index += 1) {
    deepValue = { kind: "list", items: [deepValue] };
  }
  const result = validate(mutate((document) => {
    const entity = document.nodes[2];
    if (entity !== undefined && entity.kind === "entity") {
      (entity as unknown as { state: unknown }).state = deepValue;
    }
  }));
  assert.ok(expectCodes(result).includes("GAMEIR/E012"));
});
