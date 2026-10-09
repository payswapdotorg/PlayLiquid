/**
 * Module role: the tool/engine adapter REGISTRY — the runtime-side mapping
 * from tool descriptors (@playliquid/tool-fabric) to the neutral adapters
 * that serve them (@playliquid/engine-adapter-contract). Registrations are
 * validated totally (typed rejections, never thrown), capability discovery
 * is deterministic, and resolving a request to an adapter is exact: a
 * duplicate registration for the same tool identity + surface major is a
 * TYPED conflict, never a silent pick.
 *
 * Implements: PL-019 registry scope (matrix row tool-fabric-runtime | Tools |
 * tool-fabric); E1 (the registry instance is the single owner of the
 * registration table).
 */

import type { CapabilityId, ToolDescriptor, ToolIdentity } from "@playliquid/tool-fabric";
import { toolIdSlug, validateToolDescriptor } from "@playliquid/tool-fabric";
import type { Adapter, AdapterCapabilityId } from "@playliquid/engine-adapter-contract";
import {
  isAdapterLifecycleState,
  mediateAdapterCapability,
  validateAdapterCapabilityId,
  validateAdapterCapabilityList,
  validateAdapterId,
} from "@playliquid/engine-adapter-contract";

/** One tool registration: the descriptor plus the adapter that serves it. */
export interface ToolRegistration {
  readonly kind: "tool-registration";
  readonly descriptor: ToolDescriptor;
  readonly adapter: Adapter;
  /** The adapter capability tool invocations are dispatched through. */
  readonly dispatchCapability: AdapterCapabilityId;
}

export type RegistryRejectionCode =
  | "registry/not-an-object"
  | "registry/descriptor-missing"
  | "registry/descriptor-invalid"
  | "registry/adapter-missing"
  | "registry/adapter-not-an-object"
  | "registry/adapter-id-invalid"
  | "registry/adapter-state-invalid"
  | "registry/adapter-capabilities-invalid"
  | "registry/adapter-dispatch-missing"
  | "registry/dispatch-capability-invalid"
  | "registry/dispatch-capability-undeclared"
  | "registry/duplicate-tool";

export interface RegistryRejection {
  readonly code: RegistryRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type RegistrationCheck =
  | { readonly outcome: "ok"; readonly registration: ToolRegistration }
  | { readonly outcome: "rejected"; readonly rejections: readonly RegistryRejection[] };

function registryRejection(code: RegistryRejectionCode, message: string, path: string): RegistryRejection {
  return Object.freeze({ code, message, path });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an untrusted tool registration { descriptor, adapter,
 * dispatchCapability }. Total; never throws; accumulates every problem.
 */
export function validateToolRegistration(input: unknown): RegistrationCheck {
  if (!isPlainObject(input)) {
    return {
      outcome: "rejected",
      rejections: [registryRejection("registry/not-an-object", "tool registration must be a non-array object", "")],
    };
  }
  const rejections: RegistryRejection[] = [];

  let descriptor: ToolDescriptor | undefined;
  if (input["descriptor"] === undefined) {
    rejections.push(registryRejection("registry/descriptor-missing", "descriptor is required", "descriptor"));
  } else {
    const descriptorCheck = validateToolDescriptor(input["descriptor"]);
    if (descriptorCheck.outcome === "ok") {
      descriptor = descriptorCheck.descriptor;
    } else {
      rejections.push(
        registryRejection(
          "registry/descriptor-invalid",
          `tool descriptor invalid: ${descriptorCheck.rejections.map((item) => item.message).join("; ")}`,
          "descriptor",
        ),
      );
    }
  }

  let adapter: Adapter | undefined;
  const rawAdapter = input["adapter"];
  if (rawAdapter === undefined) {
    rejections.push(registryRejection("registry/adapter-missing", "adapter is required", "adapter"));
  } else if (!isPlainObject(rawAdapter)) {
    rejections.push(registryRejection("registry/adapter-not-an-object", "adapter must be a non-array object", "adapter"));
  } else {
    const idCheck = validateAdapterId(rawAdapter["id"]);
    if (idCheck.outcome === "rejected") {
      rejections.push(registryRejection("registry/adapter-id-invalid", `adapter id invalid: ${idCheck.rejection.message}`, "adapter.id"));
    }
    if (!isAdapterLifecycleState(rawAdapter["state"])) {
      rejections.push(registryRejection("registry/adapter-state-invalid", "adapter state must be a neutral lifecycle state", "adapter.state"));
    }
    const capabilityCheck = validateAdapterCapabilityList(rawAdapter["offeredCapabilities"]);
    if (capabilityCheck.outcome === "rejected") {
      rejections.push(
        registryRejection(
          "registry/adapter-capabilities-invalid",
          `adapter offeredCapabilities invalid: ${capabilityCheck.rejections.map((item) => item.message).join("; ")}`,
          "adapter.offeredCapabilities",
        ),
      );
    }
    if (typeof rawAdapter["dispatch"] !== "function") {
      rejections.push(registryRejection("registry/adapter-dispatch-missing", "adapter must expose a dispatch function", "adapter.dispatch"));
    }
    if (
      idCheck.outcome === "ok" &&
      capabilityCheck.outcome === "ok" &&
      typeof rawAdapter["dispatch"] === "function" &&
      isAdapterLifecycleState(rawAdapter["state"])
    ) {
      adapter = rawAdapter as unknown as Adapter;
    }
  }

  let dispatchCapability: AdapterCapabilityId | undefined;
  const rawCapability = input["dispatchCapability"];
  if (rawCapability === undefined) {
    rejections.push(registryRejection("registry/dispatch-capability-invalid", "dispatchCapability is required", "dispatchCapability"));
  } else {
    const capabilityCheck = validateAdapterCapabilityId(rawCapability);
    if (capabilityCheck.outcome === "ok") {
      dispatchCapability = capabilityCheck.capability;
    } else {
      rejections.push(registryRejection("registry/dispatch-capability-invalid", `dispatchCapability invalid: ${capabilityCheck.rejection.message}`, "dispatchCapability"));
    }
  }

  if (dispatchCapability !== undefined && adapter !== undefined) {
    const mediation = mediateAdapterCapability(adapter.offeredCapabilities, dispatchCapability);
    if (mediation.outcome === "refused") {
      rejections.push(
        registryRejection(
          "registry/dispatch-capability-undeclared",
          `dispatchCapability ${dispatchCapability} is not declared by adapter ${adapter.id}`,
          "dispatchCapability",
        ),
      );
    }
  }

  if (rejections.length > 0 || descriptor === undefined || adapter === undefined || dispatchCapability === undefined) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  const registration: ToolRegistration = { kind: "tool-registration", descriptor, adapter, dispatchCapability };
  return { outcome: "ok", registration: Object.freeze(registration) };
}

export type ToolResolutionCode = "registry/tool-not-registered" | "registry/surface-major-unavailable";

export type ToolResolution =
  | { readonly outcome: "ok"; readonly registration: ToolRegistration }
  | {
      readonly outcome: "rejected";
      readonly code: ToolResolutionCode;
      readonly message: string;
      /** Present iff the tool exists under other surface majors. Sorted. */
      readonly registeredMajors?: readonly number[];
    };

export type UnregisterCheck =
  | { readonly outcome: "ok"; readonly identity: ToolIdentity; readonly major: number }
  | { readonly outcome: "rejected"; readonly code: "registry/tool-not-registered"; readonly message: string };

export interface ToolFabricRegistry {
  /** Validates and installs a tool registration. Duplicate keys are a typed conflict. */
  register(input: unknown): RegistrationCheck;
  /** Removes the registration for a tool identity + surface major. */
  unregister(identity: unknown, surfaceMajor: number): UnregisterCheck;
  /** Deterministic exact resolution of a tool identity + surface major. */
  resolve(identity: ToolIdentity, surfaceMajor: number): ToolResolution;
  /** Registrations whose descriptors declare the capability. Sorted by slug, then major. */
  discoverByCapability(capability: CapabilityId): readonly ToolRegistration[];
  /** All registrations, sorted by slug, then major. */
  list(): readonly ToolRegistration[];
}

function registrationKey(identity: ToolIdentity, major: number): string {
  return `${toolIdSlug(identity)}|${major}`;
}

function compareRegistrations(left: ToolRegistration, right: ToolRegistration): number {
  const slug = toolIdSlug(left.descriptor.identity).localeCompare(toolIdSlug(right.descriptor.identity));
  if (slug !== 0) {
    return slug;
  }
  return left.descriptor.surfaceVersion.major - right.descriptor.surfaceVersion.major;
}

/** Creates a fresh, empty tool registry. The instance owns its table (E1). */
export function createToolFabricRegistry(): ToolFabricRegistry {
  const table = new Map<string, ToolRegistration>();

  function register(input: unknown): RegistrationCheck {
    const check = validateToolRegistration(input);
    if (check.outcome === "rejected") {
      return check;
    }
    const registration = check.registration;
    const key = registrationKey(registration.descriptor.identity, registration.descriptor.surfaceVersion.major);
    const existing = table.get(key);
    if (existing !== undefined) {
      const rejection: RegistryRejection = registryRejection(
        "registry/duplicate-tool",
        `tool ${toolIdSlug(registration.descriptor.identity)} surface major ${registration.descriptor.surfaceVersion.major} is already registered on adapter ${existing.adapter.id}`,
        "descriptor.identity",
      );
      return { outcome: "rejected", rejections: Object.freeze([rejection]) };
    }
    table.set(key, registration);
    return { outcome: "ok", registration };
  }

  function unregister(identity: unknown, surfaceMajor: number): UnregisterCheck {
    const identityCheck = identityGuard(identity);
    if (identityCheck !== null) {
      return { outcome: "rejected", code: "registry/tool-not-registered", message: identityCheck };
    }
    if (typeof surfaceMajor !== "number" || !Number.isInteger(surfaceMajor) || surfaceMajor < 0) {
      return {
        outcome: "rejected",
        code: "registry/tool-not-registered",
        message: "surface major must be a non-negative integer",
      };
    }
    const typed = identity as ToolIdentity;
    const key = registrationKey(typed, surfaceMajor);
    if (!table.delete(key)) {
      return {
        outcome: "rejected",
        code: "registry/tool-not-registered",
        message: `tool ${toolIdSlug(typed)} surface major ${surfaceMajor} is not registered`,
      };
    }
    return { outcome: "ok", identity: typed, major: surfaceMajor };
  }

  function resolve(identity: ToolIdentity, surfaceMajor: number): ToolResolution {
    const key = registrationKey(identity, surfaceMajor);
    const registration = table.get(key);
    if (registration !== undefined) {
      return { outcome: "ok", registration };
    }
    const majors: number[] = [];
    for (const candidate of table.values()) {
      if (toolIdSlug(candidate.descriptor.identity) === toolIdSlug(identity)) {
        majors.push(candidate.descriptor.surfaceVersion.major);
      }
    }
    if (majors.length === 0) {
      return {
        outcome: "rejected",
        code: "registry/tool-not-registered",
        message: `tool ${toolIdSlug(identity)} is not registered`,
      };
    }
    majors.sort((left, right) => left - right);
    return {
      outcome: "rejected",
      code: "registry/surface-major-unavailable",
      message: `tool ${toolIdSlug(identity)} is registered under surface majors [${majors.join(", ")}] but not ${surfaceMajor}`,
      registeredMajors: Object.freeze(majors),
    };
  }

  function discoverByCapability(capability: CapabilityId): readonly ToolRegistration[] {
    const matches = [...table.values()].filter((registration) => registration.descriptor.capabilities.includes(capability));
    matches.sort(compareRegistrations);
    return Object.freeze(matches);
  }

  function list(): readonly ToolRegistration[] {
    const all = [...table.values()];
    all.sort(compareRegistrations);
    return Object.freeze(all);
  }

  return Object.freeze({ register, unregister, resolve, discoverByCapability, list });
}

function identityGuard(identity: unknown): string | null {
  if (!isPlainObject(identity)) {
    return "tool identity must be a non-array object";
  }
  if (typeof identity["namespace"] !== "string" || typeof identity["name"] !== "string") {
    return "tool identity must carry string namespace and name";
  }
  return null;
}
