/**
 * Module role: provenance hooks for tool-call outcomes. Every typed outcome
 * carries a CallProvenance with exactly the fields platform contracts
 * require — the tool identity and the declared surface version. There is
 * deliberately NO engagement-telemetry field on this type: the fabric never
 * fabricates engagement telemetry; engagement accounting is owned by the
 * runtime/platform layers, never invented here.
 *
 * Implements: PL-005 §3.A.5 (provenance hooks).
 */

import type { ToolIdentity } from "./descriptor.ts";
import { validateToolIdentity } from "./descriptor.ts";
import type { SurfaceVersion } from "./versioning.ts";
import { validateSurfaceVersion } from "./versioning.ts";
import { snapshotRecord } from "./inspect.ts";

/** Provenance attached to every typed tool-call outcome. */
export interface CallProvenance {
  readonly kind: "call-provenance";
  readonly tool: ToolIdentity;
  readonly declaredSurface: SurfaceVersion;
}

export type ProvenanceRejectionCode =
  | "provenance/not-an-object"
  | "provenance/kind-invalid"
  | "provenance/tool-invalid"
  | "provenance/surface-invalid";

export interface ProvenanceRejection {
  readonly code: ProvenanceRejectionCode;
  readonly message: string;
}

export type CallProvenanceValidation =
  | { readonly outcome: "ok"; readonly provenance: CallProvenance }
  | { readonly outcome: "rejected"; readonly rejections: readonly ProvenanceRejection[] };

function rejection(code: ProvenanceRejectionCode, message: string): ProvenanceRejection {
  return Object.freeze({ code, message });
}

/** Builds a frozen CallProvenance from already-typed inputs. */
export function buildCallProvenance(tool: ToolIdentity, declaredSurface: SurfaceVersion): CallProvenance {
  const provenance: CallProvenance = { kind: "call-provenance", tool, declaredSurface };
  return Object.freeze(provenance);
}

/**
 * Validates an untrusted value as a CallProvenance. Total; never throws;
 * accumulates every problem.
 */
export function validateCallProvenance(input: unknown): CallProvenanceValidation {
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("provenance/not-an-object", "call provenance must be a non-array object")],
    };
  }
  const rejections: ProvenanceRejection[] = [];

  const kind = record["kind"];
  if (kind !== "call-provenance") {
    rejections.push(rejection("provenance/kind-invalid", 'provenance kind must be the literal "call-provenance"'));
  }

  let tool: ToolIdentity | undefined;
  const toolResult = validateToolIdentity(record["tool"], "tool");
  if (toolResult.outcome === "ok") {
    tool = toolResult.identity;
  } else {
    rejections.push(
      rejection("provenance/tool-invalid", `tool identity invalid: ${toolResult.rejections.map((item) => item.message).join("; ")}`),
    );
  }

  let declaredSurface: SurfaceVersion | undefined;
  const surfaceResult = validateSurfaceVersion(record["declaredSurface"]);
  if (surfaceResult.outcome === "ok") {
    declaredSurface = surfaceResult.version;
  } else {
    rejections.push(rejection("provenance/surface-invalid", `declaredSurface invalid: ${surfaceResult.rejection.message}`));
  }

  if (rejections.length > 0 || tool === undefined || declaredSurface === undefined) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }

  const provenance: CallProvenance = { kind: "call-provenance", tool, declaredSurface };
  return { outcome: "ok", provenance: Object.freeze(provenance) };
}
