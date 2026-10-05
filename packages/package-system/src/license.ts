/**
 * License and rights-state contract.
 *
 * Spec: spec/package-contract.md "Required metadata: license/rights state"
 * and "Publication: publication/build must fail closed when required
 * license/provenance evidence is missing" (R19).
 *
 * The rights state of a derivative is retained across the derivation chain
 * (see `provenance.ts`); the release gate requires the state to be verified
 * before publication.
 */

import type { CasArtifactRef } from './cas.ts'

/** Verification status of the declared license. */
export type LicenseStatus = 'verified' | 'declared' | 'unknown'

/** The license/rights state of a package. */
export interface LicenseState {
  /**
   * SPDX license expression, e.g. `Apache-2.0`, `MIT OR Apache-2.0`,
   * `CC-BY-4.0`.
   */
  readonly spdxExpression: string
  readonly status: LicenseStatus
  /** Optional content-addressed third-party notices backing the expression. */
  readonly notices?: readonly CasArtifactRef[]
}

const SPDX_EXPRESSION_PATTERN = /^[A-Za-z0-9.+\-() ]{1,256}$/

/** Light structural check of an SPDX expression string. */
export function isValidSpdxExpression(expression: string): boolean {
  return (
    typeof expression === 'string' && SPDX_EXPRESSION_PATTERN.test(expression)
  )
}

/** Type guard: a structurally valid license state. */
export function isLicenseState(value: unknown): value is LicenseState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<LicenseState>
  return (
    isValidSpdxExpression(candidate.spdxExpression ?? '') &&
    (candidate.status === 'verified' ||
      candidate.status === 'declared' ||
      candidate.status === 'unknown')
  )
}
