/**
 * The BuildExecutor port — ports, not engines.
 *
 * This package defines the CONTRACT of build execution and nothing else:
 * no toolchain invocation, no process spawning, no IO, no engine SDKs.
 * The real executor is the build orchestrator (Work Order PL-020), which
 * drives Tool Fabric operations behind this interface. Deterministic
 * in-memory fakes for tests live in `fixtures.ts` (NOT exported from the
 * package barrel).
 *
 * Determinism discipline (E9): an executor honoring this port MUST be
 * deterministic — the same execution command always produces the same
 * outputs (same digests, same manifest). Console-class (vendor-gated)
 * builds REQUIRE caller-supplied vendor evidence; an executor must fail
 * closed (`vendor-evidence-required`) rather than fabricate authorization
 * — console capability is proven, never simulated (lock rule 24, E11).
 */

import type { AdmittedBuildRequest } from "./commands.ts";
import type { VerificationEvidence } from "./verification.ts";
import type { BuildOutputs } from "./outputs.ts";

/** One execution command: an admitted request plus out-of-band vendor evidence. */
export interface BuildExecutionCommand {
  readonly request: AdmittedBuildRequest;
  /**
   * Vendor evidence supplied by the authorized vendor pipeline
   * (console-class builds). Executors never fabricate these records.
   */
  readonly vendorEvidence?: readonly VerificationEvidence[];
}

/** Why a build execution can fail at the contract level. */
export type BuildExecutionErrorCode = "invalid-command" | "vendor-evidence-required";

/** The result of one build execution. */
export type BuildExecutionResult =
  | { readonly ok: true; readonly outputs: BuildOutputs }
  | {
      readonly ok: false;
      readonly code: BuildExecutionErrorCode;
      readonly message: string;
    };

/**
 * The pure build execution port. Implementations (PL-020 build
 * orchestrator; test fakes in `fixtures.ts`) MUST:
 * - be deterministic (E9): same command ⇒ same outputs;
 * - refuse vendor-gated builds without vendor evidence (`vendor-evidence-required`);
 * - emit outputs that pass `validateBuildOutputs` against the request inputs.
 */
export interface BuildExecutor {
  readonly execute: (command: BuildExecutionCommand) => BuildExecutionResult;
}
