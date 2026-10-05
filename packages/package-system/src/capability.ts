/**
 * Capability and permission contracts.
 *
 * Spec: spec/package-contract.md "Required metadata: capabilities
 * provided/required; permissions" and "Security: a package cannot obtain
 * undeclared capabilities".
 *
 * The Capability Broker remains the runtime authorization boundary
 * (architecture-lock rule 4); these types are the static declarations the
 * broker and the resolver reason over.
 */

import type { SemverRange, SemanticVersion } from './semver.ts'
import { semverSatisfies } from './semver.ts'

/** A capability identifier, e.g. `asset.mesh-format`. */
export type CapabilityId = string

/** A capability this package provides to the graph. */
export interface CapabilityDeclaration {
  readonly id: CapabilityId
  readonly version: SemanticVersion
  readonly description?: string
}

/** A capability this package requires from the graph or the host. */
export interface CapabilityReference {
  readonly id: CapabilityId
  readonly constraint: SemverRange
}

/** Access mode requested by a permission. */
export type PermissionAccess = 'read' | 'write' | 'execute'

/** A runtime permission request scoped to one declared capability. */
export interface PermissionRequest {
  readonly capability: CapabilityId
  readonly access: PermissionAccess
  /** Optional fine-grained scope token, e.g. `region:eu-1`. */
  readonly scope?: string
  readonly justification?: string
}

/**
 * Finds a declaration satisfying a capability reference, or `null`.
 * Pure; result depends only on the provided list and the reference.
 */
export function capabilityProvided(
  provided: readonly CapabilityDeclaration[],
  reference: CapabilityReference,
): CapabilityDeclaration | null {
  for (const declaration of provided) {
    if (
      declaration.id === reference.id &&
      semverSatisfies(declaration.version, reference.constraint)
    ) {
      return declaration
    }
  }
  return null
}

/**
 * Returns every permission whose capability is not declared by the package
 * itself (neither required nor provided). Non-empty result means the package
 * is attempting to obtain undeclared capabilities — rejected fail-closed.
 */
export function undeclaredCapabilities(
  required: readonly CapabilityReference[],
  provided: readonly CapabilityDeclaration[],
  permissions: readonly PermissionRequest[],
): readonly PermissionRequest[] {
  const declared = new Set<CapabilityId>()
  for (const reference of required) {
    declared.add(reference.id)
  }
  for (const declaration of provided) {
    declared.add(declaration.id)
  }
  return permissions.filter((permission) => !declared.has(permission.capability))
}
