/**
 * Module role: tool identity & descriptor contracts — the typed identity of
 * a fabric tool and the descriptor that publishes its versioned capability
 * surface (title/description, input/output schema shape refs, required
 * capabilities, default timeout). validateToolDescriptor is total: typed
 * rejections (code + path) for every problem, never a thrown exception,
 * even on hostile objects; success yields a normalized, frozen descriptor
 * (unknown keys dropped).
 *
 * Implements: PL-005 §3.A.1 (tool identity & descriptors).
 */

import type { CapabilityId } from "./capability.ts";
import { validateCapabilityId } from "./capability.ts";
import type { SurfaceVersion } from "./versioning.ts";
import { validateSurfaceVersion } from "./versioning.ts";
import { snapshotRecord } from "./inspect.ts";

export interface ToolIdentity {
  /** Dotted lowercase namespace, e.g. "playliquid" or "com.acme.tools". */
  readonly namespace: string;
  /** Lowercase name, unique within the namespace; no "." or "/" (slug-safe). */
  readonly name: string;
}

/** Reference to a schema shape registered outside the descriptor (never inline schemas). */
export interface SchemaShapeRef {
  /** Canonical shape name, lowercase dot/slash segments, e.g. "playliquid.shape/dice-roll-input". */
  readonly shapeId: string;
  /** Shape revision; starts at 1, bumped on backward-compatible shape evolution. */
  readonly revision: number;
}

export const TOOL_NAMESPACE_MAX_LENGTH = 128;
export const TOOL_NAME_MAX_LENGTH = 64;
export const SHAPE_ID_MAX_LENGTH = 128;
export const TOOL_TITLE_MAX_LENGTH = 200;
export const TOOL_DESCRIPTION_MAX_LENGTH = 2000;
export const TOOL_DEFAULT_TIMEOUT_MAX_MS = 600_000;

export interface ToolDescriptor {
  readonly identity: ToolIdentity;
  readonly surfaceVersion: SurfaceVersion;
  readonly title: string;
  readonly description: string;
  readonly inputShape: SchemaShapeRef;
  readonly outputShape: SchemaShapeRef;
  /** Capabilities every invocation of this tool requires. */
  readonly capabilities: readonly CapabilityId[];
  /** Suggested per-call budget in ms. Optional; the request deadline wins. */
  readonly defaultTimeoutMs?: number;
}

export type DescriptorRejectionCode =
  | "descriptor/not-an-object"
  | "descriptor/identity-not-an-object"
  | "descriptor/namespace-missing"
  | "descriptor/namespace-format"
  | "descriptor/name-missing"
  | "descriptor/name-format"
  | "descriptor/surface-version-invalid"
  | "descriptor/title-missing"
  | "descriptor/title-too-long"
  | "descriptor/description-missing"
  | "descriptor/description-too-long"
  | "descriptor/shape-not-an-object"
  | "descriptor/shape-id-missing"
  | "descriptor/shape-id-format"
  | "descriptor/shape-revision-missing"
  | "descriptor/shape-revision-invalid"
  | "descriptor/capabilities-not-an-array"
  | "descriptor/capability-entry-invalid"
  | "descriptor/capability-duplicate"
  | "descriptor/default-timeout-invalid"
  | "descriptor/default-timeout-too-large";

export interface DescriptorRejection {
  readonly code: DescriptorRejectionCode;
  readonly message: string;
  /** "" for the whole descriptor, otherwise e.g. "identity.namespace" or "capabilities[2]". */
  readonly path: string;
}

export type ToolIdentityValidation =
  | { readonly outcome: "ok"; readonly identity: ToolIdentity }
  | { readonly outcome: "rejected"; readonly rejections: readonly DescriptorRejection[] };

export type DescriptorValidation =
  | { readonly outcome: "ok"; readonly descriptor: ToolDescriptor }
  | { readonly outcome: "rejected"; readonly rejections: readonly DescriptorRejection[] };

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const SHAPE_ID_PATTERN = /^[a-z][a-z0-9-]*([./][a-z][a-z0-9-]*)*$/;

function rejection(code: DescriptorRejectionCode, message: string, path: string): DescriptorRejection {
  return Object.freeze({ code, message, path });
}

/**
 * Validates an untrusted tool identity. `path` is the field path the
 * identity sits at ("identity" standalone, "tool" inside a call request).
 * Total; never throws.
 */
export function validateToolIdentity(input: unknown, path = "identity"): ToolIdentityValidation {
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [
        rejection("descriptor/identity-not-an-object", "tool identity must be a non-array object", path),
      ],
    };
  }
  const rejections: DescriptorRejection[] = [];
  const namespace = record["namespace"];
  if (typeof namespace !== "string" || namespace.length === 0) {
    rejections.push(rejection("descriptor/namespace-missing", "tool identity namespace must be a non-empty string", `${path}.namespace`));
  } else if (namespace.length > TOOL_NAMESPACE_MAX_LENGTH || !NAMESPACE_PATTERN.test(namespace)) {
    rejections.push(rejection("descriptor/namespace-format", `tool identity namespace must be dot-separated lowercase segments starting with a letter (max ${TOOL_NAMESPACE_MAX_LENGTH} chars)`, `${path}.namespace`));
  }
  const name = record["name"];
  if (typeof name !== "string" || name.length === 0) {
    rejections.push(rejection("descriptor/name-missing", "tool identity name must be a non-empty string", `${path}.name`));
  } else if (name.length > TOOL_NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) {
    rejections.push(rejection("descriptor/name-format", `tool identity name must be lowercase letters/digits/hyphens starting with a letter (max ${TOOL_NAME_MAX_LENGTH} chars)`, `${path}.name`));
  }
  if (rejections.length > 0) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  const identity: ToolIdentity = { namespace: namespace as string, name: name as string };
  return { outcome: "ok", identity: Object.freeze(identity) };
}

function validateShapeRef(input: unknown, path: string, rejections: DescriptorRejection[]): SchemaShapeRef | undefined {
  const record = snapshotRecord(input);
  if (record === null) {
    rejections.push(rejection("descriptor/shape-not-an-object", `${path} must be a non-array object with shapeId and revision`, path));
    return undefined;
  }
  let shapeId: string | undefined;
  const rawShapeId = record["shapeId"];
  if (typeof rawShapeId !== "string" || rawShapeId.length === 0) {
    rejections.push(rejection("descriptor/shape-id-missing", `${path}.shapeId must be a non-empty string`, `${path}.shapeId`));
  } else if (rawShapeId.length > SHAPE_ID_MAX_LENGTH || !SHAPE_ID_PATTERN.test(rawShapeId)) {
    rejections.push(rejection("descriptor/shape-id-format", `${path}.shapeId must be lowercase dot/slash segments starting with a letter (max ${SHAPE_ID_MAX_LENGTH} chars)`, `${path}.shapeId`));
  } else {
    shapeId = rawShapeId;
  }
  let revision: number | undefined;
  const rawRevision = record["revision"];
  if (typeof rawRevision !== "number" || !Number.isInteger(rawRevision)) {
    rejections.push(rejection("descriptor/shape-revision-missing", `${path}.revision must be an integer`, `${path}.revision`));
  } else if (rawRevision < 1) {
    rejections.push(rejection("descriptor/shape-revision-invalid", `${path}.revision must be >= 1`, `${path}.revision`));
  } else {
    revision = rawRevision;
  }
  if (shapeId === undefined || revision === undefined) {
    return undefined;
  }
  const shape: SchemaShapeRef = { shapeId, revision };
  return Object.freeze(shape);
}

/**
 * Validates an untrusted tool descriptor. Total; never throws; accumulates
 * every problem in one pass; normalizes to a frozen descriptor.
 */
export function validateToolDescriptor(input: unknown): DescriptorValidation {
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("descriptor/not-an-object", "tool descriptor must be a non-array object", "")],
    };
  }
  const rejections: DescriptorRejection[] = [];

  let identity: ToolIdentity | undefined;
  const identityResult = validateToolIdentity(record["identity"], "identity");
  if (identityResult.outcome === "ok") {
    identity = identityResult.identity;
  } else {
    rejections.push(...identityResult.rejections);
  }

  let surfaceVersion: SurfaceVersion | undefined;
  const surfaceResult = validateSurfaceVersion(record["surfaceVersion"]);
  if (surfaceResult.outcome === "ok") {
    surfaceVersion = surfaceResult.version;
  } else {
    rejections.push(rejection("descriptor/surface-version-invalid", `surfaceVersion invalid: ${surfaceResult.rejection.message}`, "surfaceVersion"));
  }

  let title: string | undefined;
  const rawTitle = record["title"];
  if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
    rejections.push(rejection("descriptor/title-missing", "title must be a non-empty string", "title"));
  } else if (rawTitle.length > TOOL_TITLE_MAX_LENGTH) {
    rejections.push(rejection("descriptor/title-too-long", `title must be at most ${TOOL_TITLE_MAX_LENGTH} characters`, "title"));
  } else {
    title = rawTitle;
  }

  let description: string | undefined;
  const rawDescription = record["description"];
  if (typeof rawDescription !== "string" || rawDescription.trim().length === 0) {
    rejections.push(rejection("descriptor/description-missing", "description must be a non-empty string", "description"));
  } else if (rawDescription.length > TOOL_DESCRIPTION_MAX_LENGTH) {
    rejections.push(rejection("descriptor/description-too-long", `description must be at most ${TOOL_DESCRIPTION_MAX_LENGTH} characters`, "description"));
  } else {
    description = rawDescription;
  }

  const inputShape = validateShapeRef(record["inputShape"], "inputShape", rejections);
  const outputShape = validateShapeRef(record["outputShape"], "outputShape", rejections);

  let capabilities: readonly CapabilityId[] | undefined;
  const rawCapabilities = record["capabilities"];
  if (!Array.isArray(rawCapabilities)) {
    rejections.push(rejection("descriptor/capabilities-not-an-array", "capabilities must be an array of capability ids", "capabilities"));
  } else {
    const entries: readonly unknown[] = rawCapabilities;
    const seen = new Set<string>();
    const list: CapabilityId[] = [];
    let valid = true;
    for (let index = 0; index < entries.length; index += 1) {
      const check = validateCapabilityId(entries[index]);
      if (check.outcome === "rejected") {
        valid = false;
        rejections.push(rejection("descriptor/capability-entry-invalid", `capabilities[${index}] invalid: ${check.rejection.message}`, `capabilities[${index}]`));
        continue;
      }
      if (seen.has(check.capability)) {
        valid = false;
        rejections.push(rejection("descriptor/capability-duplicate", `capabilities[${index}] duplicates an earlier entry`, `capabilities[${index}]`));
        continue;
      }
      seen.add(check.capability);
      list.push(check.capability);
    }
    if (valid) {
      capabilities = Object.freeze(list);
    }
  }

  let defaultTimeoutMs: number | undefined;
  const rawTimeout = record["defaultTimeoutMs"];
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout !== "number" || !Number.isInteger(rawTimeout) || rawTimeout <= 0) {
      rejections.push(rejection("descriptor/default-timeout-invalid", "defaultTimeoutMs must be a positive integer (milliseconds)", "defaultTimeoutMs"));
    } else if (rawTimeout > TOOL_DEFAULT_TIMEOUT_MAX_MS) {
      rejections.push(rejection("descriptor/default-timeout-too-large", `defaultTimeoutMs must be at most ${TOOL_DEFAULT_TIMEOUT_MAX_MS}`, "defaultTimeoutMs"));
    } else {
      defaultTimeoutMs = rawTimeout;
    }
  }

  if (
    rejections.length > 0 ||
    identity === undefined ||
    surfaceVersion === undefined ||
    title === undefined ||
    description === undefined ||
    inputShape === undefined ||
    outputShape === undefined ||
    capabilities === undefined
  ) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }

  const descriptor: ToolDescriptor = {
    identity,
    surfaceVersion,
    title,
    description,
    inputShape,
    outputShape,
    capabilities,
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
  };
  return { outcome: "ok", descriptor: Object.freeze(descriptor) };
}

/** Canonical "namespace/name" slug for a tool identity. */
export function toolIdSlug(identity: ToolIdentity): string {
  return `${identity.namespace}/${identity.name}`;
}
