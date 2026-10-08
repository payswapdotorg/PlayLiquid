/**
 * KERNEL CONSTRUCTION — guarded entry point, options and limits.
 *
 * `createInteractiveRuntime` refuses simulation descriptors (PL-013 is the
 * INTERACTIVE runtime; the Simulation Runtime is PL-014 — lock rule 12:
 * shared contracts, distinct execution paths). Options carry every host
 * port the kernel needs; limits are deterministic defensive caps.
 */

import type { CapabilityPort } from "./capability-port.ts";
import type {
  InputSourcePort,
  RendererPort,
  SnapshotStorePort,
  TransportPort,
} from "./ports.ts";
import type { JsonSafeValue } from "./serialize.ts";
import type { WorldDriver } from "./world.ts";
import { InteractiveRuntimeKernel } from "./kernel.ts";
import type { RuntimeRoleKind, RuntimeSessionDescriptor } from "@playliquid/runtime-contracts";

/** Construction result: interactive kernels refuse simulation descriptors. */
export type KernelCreationResult<W extends JsonSafeValue> =
  | { readonly status: "created"; readonly kernel: InteractiveRuntimeKernel<W> }
  | { readonly status: "rejected"; readonly code: "wrong-role"; readonly detail: string };

/** Defensive caps; deterministic, so behavior is reproducible. */
export interface KernelLimits {
  readonly maxTicksPerStep: number;
  readonly maxEventsPerTick: number;
  readonly maxEventsPerCommand: number;
}

export const DEFAULT_KERNEL_LIMITS: KernelLimits = {
  maxTicksPerStep: 1024,
  maxEventsPerTick: 256,
  maxEventsPerCommand: 256,
};

/** Everything the kernel needs; every host concern is an injected port. */
export interface KernelOptions<W extends JsonSafeValue> {
  readonly descriptor: RuntimeSessionDescriptor;
  readonly driver: WorldDriver<W>;
  readonly capabilityPort: CapabilityPort;
  readonly snapshotStore: SnapshotStorePort;
  readonly renderer?: RendererPort;
  readonly inputSource?: InputSourcePort;
  readonly transport?: TransportPort;
  readonly limits?: Partial<KernelLimits>;
}

/** Construction entry point (role-guarded; see module doc). */
export function createInteractiveRuntime<W extends JsonSafeValue>(
  options: KernelOptions<W>,
): KernelCreationResult<W> {
  if (options.descriptor.role !== ("interactive" satisfies RuntimeRoleKind)) {
    return {
      status: "rejected",
      code: "wrong-role",
      detail: `interactive runtime kernel refuses role "${options.descriptor.role}" (Simulation Runtime is PL-014)`,
    };
  }
  return { status: "created", kernel: new InteractiveRuntimeKernel(options) };
}
