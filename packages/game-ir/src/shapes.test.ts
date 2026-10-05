import { test } from "node:test";
import assert from "node:assert/strict";
import { isValueShape, valueMatchesShape } from "./shapes.ts";
import type { ValueShape } from "./shapes.ts";
import type { GameIRValue } from "./values.ts";

test("shapes: every shape kind has a working guard", () => {
  const shapes: ValueShape[] = [
    { kind: "unit" },
    { kind: "bool" },
    { kind: "int" },
    { kind: "float" },
    { kind: "string" },
    { kind: "entity-ref" },
    { kind: "list", element: { kind: "int" } },
    { kind: "record", fields: { position: { kind: "list", element: { kind: "float" } } } },
  ];
  for (const shape of shapes) {
    assert.ok(isValueShape(shape), `${shape.kind} shape should validate`);
  }
  assert.equal(isValueShape({ kind: "map" }), false);
  assert.equal(isValueShape({ kind: "list" }), false);
  assert.equal(isValueShape(null), false);
});

test("shapes: values match or mismatch shapes", () => {
  const shape: ValueShape = {
    kind: "record",
    fields: { position: { kind: "list", element: { kind: "float" } }, title: { kind: "string" } },
  };
  const good: GameIRValue = {
    kind: "record",
    fields: { position: { kind: "list", items: [{ kind: "float", value: 1.5 }] }, title: { kind: "string", value: "hero" } },
  };
  const missingField: GameIRValue = { kind: "record", fields: { title: { kind: "string", value: "hero" } } };
  const wrongElement: GameIRValue = {
    kind: "record",
    fields: {
      position: { kind: "list", items: [{ kind: "int", value: 1n }] },
      title: { kind: "string", value: "hero" },
    },
  };
  const wrongKind: GameIRValue = { kind: "list", items: [] };
  assert.ok(valueMatchesShape(good, shape));
  assert.equal(valueMatchesShape(missingField, shape), false);
  assert.equal(valueMatchesShape(wrongElement, shape), false);
  assert.equal(valueMatchesShape(wrongKind, shape), false);
});

test("shapes: undeclared extra fields are permitted (extensibility)", () => {
  const shape: ValueShape = { kind: "record", fields: { a: { kind: "int" } } };
  const value: GameIRValue = { kind: "record", fields: { a: { kind: "int", value: 1n }, b: { kind: "unit" } } };
  assert.ok(valueMatchesShape(value, shape));
});
