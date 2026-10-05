/**
 * Provenance/licensing release gate (R19).
 *
 * Spec: spec/package-contract.md "Publication: publication/build must fail
 * closed when required license/provenance evidence is missing";
 * requirements R19; architecture: "Provenance/licensing is a release/build
 * gate".
 *
 * `checkReleaseGate` is pure: it evaluates the typed evidence on a package
 * record and returns `{ pass, reasons[] }`. Missing evidence fails closed.
 */

import type { PackageRecord } from './package-record.ts'
import type { RecordViolation } from './validate-record.ts'
import { validatePackageRecord } from './validate-record.ts'

/** Reason codes produced by the release gate. */
export type ReleaseGateFailureCode =
  | 'invalid-record'
  | 'digest-integrity'
  | 'inline-artifact-too-large'
  | 'license-missing'
  | 'license-unverified'
  | 'provenance-incomplete'
  | 'model-provenance-missing'

/** One gate failure reason. */
export interface ReleaseGateFailure {
  readonly code: ReleaseGateFailureCode
  readonly message: string
}

/** The gate verdict. `pass` is true only when `reasons` is empty. */
export interface ReleaseGateResult {
  readonly pass: boolean
  readonly reasons: readonly ReleaseGateFailure[]
}

const STRUCTURAL_CODES: ReadonlySet<string> = new Set([
  'digest-integrity',
  'inline-artifact-too-large',
])

function structuralReasons(violations: readonly RecordViolation[]): ReleaseGateFailure[] {
  return violations.map((violation) => ({
    code: (STRUCTURAL_CODES.has(violation.code) ? violation.code : 'invalid-record') as ReleaseGateFailureCode,
    message: violation.message,
  }))
}

/**
 * Evaluates the provenance/licensing release gate for one package record.
 *
 * Fails closed (R19): the gate passes only when the record is structurally
 * valid and digest-integral, its license/rights state is verified, its
 * provenance evidence is complete (derivatives must retain origin, source
 * commit and transformation history), and AI-generated content carries
 * disclosed model provenance.
 */
export function checkReleaseGate(record: PackageRecord): ReleaseGateResult {
  const reasons: ReleaseGateFailure[] = []
  reasons.push(...structuralReasons(validatePackageRecord(record)))

  const metadata = record?.metadata
  const license = metadata?.license
  if (
    typeof license !== 'object' ||
    license === null ||
    typeof license.spdxExpression !== 'string' ||
    license.spdxExpression.length === 0
  ) {
    reasons.push({
      code: 'license-missing',
      message: 'license/rights state is missing (R19 fail-closed)',
    })
  } else if (license.status !== 'verified') {
    reasons.push({
      code: 'license-unverified',
      message: `license state is "${String(license.status)}" but publication requires "verified" (R19 fail-closed)`,
    })
  }

  const provenance = metadata?.provenance
  const lineage = metadata?.lineage
  if (provenance !== null && provenance !== undefined) {
    if (!Array.isArray(provenance.transformationHistory) || provenance.transformationHistory.length === 0) {
      reasons.push({
        code: 'provenance-incomplete',
        message: 'transformation history is empty; authorship evidence is required',
      })
    }
    const isDerivative = lineage?.parent !== null && lineage?.parent !== undefined
    if (isDerivative) {
      if (lineage?.origin === null || lineage?.origin === undefined) {
        reasons.push({
          code: 'provenance-incomplete',
          message: 'derivative package does not retain its lineage origin',
        })
      }
      if (provenance.sourceCommit === null || provenance.sourceCommit === undefined) {
        reasons.push({
          code: 'provenance-incomplete',
          message: 'derivative package does not retain its source commit',
        })
      }
    }
    if (provenance.generatedByAi === true) {
      const modelProvenance = provenance.modelProvenance
      if (!Array.isArray(modelProvenance) || modelProvenance.length === 0) {
        reasons.push({
          code: 'model-provenance-missing',
          message: 'AI-generated package has no model provenance entries',
        })
      } else {
        for (const entry of modelProvenance) {
          if (entry?.disclosed !== true) {
            reasons.push({
              code: 'model-provenance-missing',
              message: `model provenance entry for ${String(entry?.model)} is not disclosed`,
            })
          }
        }
      }
    }
  }

  return { pass: reasons.length === 0, reasons }
}
