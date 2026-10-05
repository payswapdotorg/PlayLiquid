/**
 * Package record validation — pure, fail-closed, total.
 *
 * Returns the full list of violations in a deterministic check order; an
 * empty list means the record is structurally valid, digest-integral,
 * declares every capability it requests permission for, and respects the
 * content-addressing rules (E7). Used by resolution and by the release
 * gate.
 */

import { checkArtifactPlacement } from './cas.ts'
import type { PackageArtifact } from './cas.ts'
import { undeclaredCapabilities } from './capability.ts'
import { computePackageDigest } from './package-digest.ts'
import type { PackageRecord } from './package-record.ts'
import { isContentDigest } from './digest.ts'
import { isEvaluationSuiteRef, isSemanticPath } from './game-ir-seam.ts'
import { isLicenseState } from './license.ts'
import { isPackageKind, parsePackageId } from './package-id.ts'
import {
  isHttpUrlWithoutCredentials,
  isPackageCoordinate,
  isProvenanceRecord,
} from './provenance.ts'
import { isSemanticVersion, parseSemverRange } from './semver.ts'

/** Violation codes produced by record validation. */
export type RecordValidationCode =
  | 'invalid-kind'
  | 'invalid-id'
  | 'invalid-version'
  | 'invalid-digest'
  | 'digest-integrity'
  | 'invalid-dependency'
  | 'invalid-constraint'
  | 'invalid-capability'
  | 'invalid-permission'
  | 'undeclared-capability'
  | 'invalid-license'
  | 'invalid-provenance'
  | 'invalid-lineage'
  | 'invalid-compatibility'
  | 'invalid-resources'
  | 'invalid-evaluation-suite'
  | 'invalid-artifact'
  | 'inline-artifact-too-large'
  | 'invalid-extension-point'
  | 'invalid-overlay'
  | 'non-canonical-content'

/** One record violation. */
export interface RecordViolation {
  readonly code: RecordValidationCode
  readonly message: string
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  )
}

function checkResources(record: PackageRecord, violations: RecordViolation[]): void {
  const resources = record.metadata.resources
  if (typeof resources !== 'object' || resources === null) {
    violations.push({ code: 'invalid-resources', message: 'resources is not an object' })
    return
  }
  for (const key of ['minMemoryBytes', 'minStorageBytes', 'minCpuCores'] as const) {
    const value = resources[key]
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    ) {
      violations.push({
        code: 'invalid-resources',
        message: `${key} must be a non-negative integer`,
      })
    }
  }
}

function checkArtifacts(
  artifacts: readonly PackageArtifact[],
  violations: RecordViolation[],
): void {
  for (const artifact of artifacts) {
    const placement = checkArtifactPlacement(artifact)
    if (!placement.ok) {
      violations.push({ code: placement.code, message: placement.message })
    }
  }
}

/**
 * Validates a package record. Returns all violations, in fixed check order.
 * Pure and total: never throws (non-canonicalizable content is reported as
 * `non-canonical-content`).
 */
export function validatePackageRecord(record: PackageRecord): readonly RecordViolation[] {
  const violations: RecordViolation[] = []
  const identity = record?.identity
  const metadata = record?.metadata
  if (
    typeof record !== 'object' ||
    record === null ||
    typeof identity !== 'object' ||
    identity === null ||
    typeof metadata !== 'object' ||
    metadata === null
  ) {
    return [{ code: 'invalid-kind', message: 'record is not an object with identity and metadata' }]
  }

  if (!isPackageKind(identity.kind)) {
    violations.push({ code: 'invalid-kind', message: `unknown package kind: ${String(identity.kind)}` })
  }
  if (parsePackageId(identity.id ?? '') === null) {
    violations.push({ code: 'invalid-id', message: `invalid package id: ${String(identity.id)}` })
  }
  if (!isSemanticVersion(identity.version)) {
    violations.push({ code: 'invalid-version', message: 'identity.version is not a parsed semantic version' })
  }
  if (!isContentDigest(identity.contentDigest)) {
    violations.push({ code: 'invalid-digest', message: 'identity.contentDigest is malformed' })
  }

  try {
    if (computePackageDigest(record) !== identity.contentDigest) {
      violations.push({
        code: 'digest-integrity',
        message: 'declared contentDigest does not match the record content (tampered or mis-sealed)',
      })
    }
  } catch (error) {
    violations.push({
      code: 'non-canonical-content',
      message: `record content is not canonicalizable: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  if (!Array.isArray(metadata.dependencies)) {
    violations.push({ code: 'invalid-dependency', message: 'dependencies is not an array' })
  } else {
    for (const dependency of metadata.dependencies) {
      if (parsePackageId(dependency?.id ?? '') === null) {
        violations.push({ code: 'invalid-dependency', message: `dependency id is invalid: ${String(dependency?.id)}` })
        continue
      }
      if (parseSemverRange(dependency?.constraint ?? '') === null) {
        violations.push({
          code: 'invalid-constraint',
          message: `dependency ${dependency.id} has invalid constraint: ${String(dependency?.constraint)}`,
        })
      }
      if (dependency.kind !== null && !isPackageKind(dependency.kind)) {
        violations.push({
          code: 'invalid-dependency',
          message: `dependency ${dependency.id} declares unknown kind: ${String(dependency.kind)}`,
        })
      }
    }
  }

  if (!Array.isArray(metadata.requiredCapabilities)) {
    violations.push({ code: 'invalid-capability', message: 'requiredCapabilities is not an array' })
  } else {
    for (const reference of metadata.requiredCapabilities) {
      if (typeof reference?.id !== 'string' || reference.id.length === 0) {
        violations.push({ code: 'invalid-capability', message: 'required capability has invalid id' })
      } else if (parseSemverRange(reference.constraint ?? '') === null) {
        violations.push({
          code: 'invalid-constraint',
          message: `required capability ${reference.id} has invalid constraint`,
        })
      }
    }
  }

  if (!Array.isArray(metadata.providedCapabilities)) {
    violations.push({ code: 'invalid-capability', message: 'providedCapabilities is not an array' })
  } else {
    for (const declaration of metadata.providedCapabilities) {
      if (typeof declaration?.id !== 'string' || declaration.id.length === 0) {
        violations.push({ code: 'invalid-capability', message: 'provided capability has invalid id' })
      } else if (!isSemanticVersion(declaration.version)) {
        violations.push({
          code: 'invalid-capability',
          message: `provided capability ${declaration.id} has invalid version`,
        })
      }
    }
  }

  if (!Array.isArray(metadata.permissions)) {
    violations.push({ code: 'invalid-permission', message: 'permissions is not an array' })
  } else {
    const validAccess = new Set(['read', 'write', 'execute'])
    for (const permission of metadata.permissions) {
      if (
        typeof permission?.capability !== 'string' ||
        permission.capability.length === 0 ||
        !validAccess.has(permission.access ?? '')
      ) {
        violations.push({
          code: 'invalid-permission',
          message: `permission is malformed: ${String(permission?.capability)}`,
        })
      }
    }
    const undeclared = undeclaredCapabilities(
      Array.isArray(metadata.requiredCapabilities) ? metadata.requiredCapabilities : [],
      Array.isArray(metadata.providedCapabilities) ? metadata.providedCapabilities : [],
      metadata.permissions,
    )
    for (const permission of undeclared) {
      violations.push({
        code: 'undeclared-capability',
        message: `permission references undeclared capability: ${permission.capability} (packages cannot obtain undeclared capabilities)`,
      })
    }
  }

  if (!isLicenseState(metadata.license)) {
    violations.push({ code: 'invalid-license', message: 'license state is missing or malformed' })
  }

  if (!isProvenanceRecord(metadata.provenance)) {
    violations.push({ code: 'invalid-provenance', message: 'provenance record is missing or malformed' })
  } else if (metadata.provenance.origin.type === 'repository') {
    if (!isHttpUrlWithoutCredentials(metadata.provenance.origin.url)) {
      violations.push({
        code: 'invalid-provenance',
        message: 'provenance origin URL must be http(s) without embedded credentials',
      })
    }
  }

  const lineage = metadata.lineage
  if (typeof lineage !== 'object' || lineage === null) {
    violations.push({ code: 'invalid-lineage', message: 'lineage is missing or malformed' })
  } else {
    if (lineage.origin !== null && !isPackageCoordinate(lineage.origin)) {
      violations.push({ code: 'invalid-lineage', message: 'lineage.origin is not a valid package coordinate' })
    }
    if (lineage.parent !== null && !isPackageCoordinate(lineage.parent)) {
      violations.push({ code: 'invalid-lineage', message: 'lineage.parent is not a valid package coordinate' })
    }
  }

  const compatibility = metadata.compatibility
  if (
    typeof compatibility !== 'object' ||
    compatibility === null ||
    !isStringArray(compatibility.runtimes) ||
    !isStringArray(compatibility.engines) ||
    !Array.isArray(compatibility.targets)
  ) {
    violations.push({ code: 'invalid-compatibility', message: 'compatibility is malformed' })
  }

  checkResources(record, violations)

  if (!Array.isArray(metadata.evaluationSuites)) {
    violations.push({ code: 'invalid-evaluation-suite', message: 'evaluationSuites is not an array' })
  } else {
    for (const suite of metadata.evaluationSuites) {
      if (!isEvaluationSuiteRef(suite)) {
        violations.push({ code: 'invalid-evaluation-suite', message: 'evaluation suite reference is malformed' })
      }
    }
  }

  if (!Array.isArray(metadata.artifacts)) {
    violations.push({ code: 'invalid-artifact', message: 'artifacts is not an array' })
  } else {
    checkArtifacts(metadata.artifacts, violations)
  }

  if (!Array.isArray(metadata.extensionPoints)) {
    violations.push({ code: 'invalid-extension-point', message: 'extensionPoints is not an array' })
  } else {
    for (const point of metadata.extensionPoints) {
      if (typeof point?.pointId !== 'string' || point.pointId.length === 0) {
        violations.push({ code: 'invalid-extension-point', message: 'extension point has invalid id' })
      } else if (!isContentDigest(point.valueSchemaDigest)) {
        violations.push({
          code: 'invalid-extension-point',
          message: `extension point ${point.pointId} has invalid value schema digest`,
        })
      }
    }
  }

  const overlay = metadata.overlay
  if (overlay !== null && overlay !== undefined) {
    if (typeof overlay !== 'object' || !isPackageCoordinate(overlay?.target)) {
      violations.push({ code: 'invalid-overlay', message: 'overlay target is not a valid package coordinate' })
    } else if (!Array.isArray(overlay.overrides)) {
      violations.push({ code: 'invalid-overlay', message: 'overlay overrides is not an array' })
    } else {
      for (const override of overlay.overrides) {
        if (!isSemanticPath(override?.path)) {
          violations.push({ code: 'invalid-overlay', message: `overlay override path is invalid: ${String(override?.path)}` })
        } else if (!isContentDigest(override.valueDigest)) {
          violations.push({ code: 'invalid-overlay', message: `overlay override ${override.path} has invalid value digest` })
        }
      }
    }
  }

  return violations
}
