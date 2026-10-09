/**
 * Module role: an in-memory ShapeCatalogPort implementation — hosts and
 * tests register validators per shape id + revision. Registered validators
 * are total by contract: they return issues (empty = valid) and never
 * throw; a throwing validator is defensively converted to a typed
 * rejection so the catalog itself stays total. The catalog answers
 * "rejected" for any shape it does not know — unvalidated input is never
 * silently accepted.
 *
 * Implements: PL-019 shape validation seam implementation.
 */

import type { InputIssue, SchemaShapeRef } from "@playliquid/tool-fabric";
import type { ShapeCatalogPort, ShapeCheck } from "./domain/ports.ts";

export type ShapeValidator = (input: unknown) => readonly InputIssue[];

export interface InMemoryShapeCatalog extends ShapeCatalogPort {
  /** Registers (or replaces) the validator for a shape id + revision. */
  register(shape: SchemaShapeRef, validator: ShapeValidator): void;
  /** Number of registered shapes (observation for tests). */
  readonly size: number;
}

/** Creates an empty in-memory shape catalog. */
export function createInMemoryShapeCatalog(): InMemoryShapeCatalog {
  const shapes = new Map<string, ShapeValidator>();

  function key(shape: SchemaShapeRef): string {
    return `${shape.shapeId}@${shape.revision}`;
  }

  return Object.freeze({
    register: (shape: SchemaShapeRef, validator: ShapeValidator): void => {
      shapes.set(key(shape), validator);
    },
    validate(shape: SchemaShapeRef, input: unknown): ShapeCheck {
      const validator = shapes.get(key(shape));
      if (validator === undefined) {
        const issue: InputIssue = {
          path: `shape:${key(shape)}`,
          message: `shape ${shape.shapeId} revision ${shape.revision} is not registered in the shape catalog`,
        };
        return { outcome: "rejected", issues: Object.freeze([issue]) };
      }
      let issues: readonly InputIssue[];
      try {
        issues = validator(input) ?? [];
      } catch (error) {
        const issue: InputIssue = {
          path: `shape:${key(shape)}`,
          message: `shape validator threw: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { outcome: "rejected", issues: Object.freeze([issue]) };
      }
      if (issues.length === 0) {
        return { outcome: "ok" };
      }
      return { outcome: "rejected", issues: Object.freeze([...issues]) };
    },
    get size(): number {
      return shapes.size;
    },
  });
}
