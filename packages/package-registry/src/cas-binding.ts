/**
 * Registry ↔ artifact-store wiring (Work Order PL-011; lock rule 10: "Game
 * lockfiles pin exact package versions/digests").
 *
 * The binding invariant: a package record's `contentDigest` — defined by
 * `@playliquid/package-system` as the SHA-256 of the canonical JSON of the
 * record with the digest field removed — is EXACTLY the CAS blob digest of
 * those canonical content bytes. Therefore:
 *
 *   - `publishRecordToCas` stores a record's content bytes in the artifact
 *     store and the resulting blob digest MUST equal the record's declared
 *     `contentDigest` (mathematically forced; asserted fail-closed anyway);
 *   - `fetchRecordFromCas` resolves a content digest back to a record by
 *     fetching, parsing, re-sealing and re-validating the blob — "a
 *     package record's content digest resolves through the artifact store";
 *   - `verifyLockAgainstStores` checks every lockfile pin against BOTH
 *     authorities: the registry (record at the pinned coordinate with the
 *     pinned digest) and the artifact store (record content present and
 *     integral; every declared CAS artifact present with the declared size
 *     and media type).
 */

import {
  canonicalJson,
  sealPackageRecord,
  validatePackageRecord,
} from '@playliquid/package-system'
import type {
  CasArtifactRef,
  ContentDigest,
  LockedPackage,
  PackageLock,
  PackageRecord,
  RecordViolation,
  ResolutionResult,
} from '@playliquid/package-system'
import { computeBlobDigest, PACKAGE_RECORD_MEDIA_TYPE, utf8Bytes } from '@playliquid/artifact-store'
import type {
  ArtifactFailureCode,
  ArtifactStore,
  BlobManifest,
  StoreResult,
} from '@playliquid/artifact-store'
import { deepFreeze } from './freeze.ts'
import type { RegistryCoordinate } from './registry-index.ts'
import type { PackageRegistry, RegistryStoreError } from './registry.ts'
import type { RegistryPublishResult } from './registry-index.ts'

/** Minimal registry read access both the index and the facade satisfy. */
export interface RegistryReadAccess {
  get(coordinate: RegistryCoordinate): PackageRecord | null
  resolveLock(lock: PackageLock): ResolutionResult
}

/**
 * The canonical content bytes of a package record: UTF-8 encoding of the
 * canonical JSON of `{ identity: {kind, id, version}, metadata }`. The CAS
 * digest of these bytes equals `record.identity.contentDigest` by the
 * package contract's digest definition.
 */
export function packageRecordContentBytes(record: PackageRecord): Uint8Array {
  return utf8Bytes(
    canonicalJson({
      identity: {
        kind: record.identity.kind,
        id: record.identity.id,
        version: record.identity.version,
      },
      metadata: record.metadata,
    }),
  )
}

/** Failure codes of the record-content CAS operations. */
export type RecordContentFailureCode =
  | 'digest-mismatch'
  | 'invalid-record-content'
  | 'invalid-record'
  | ArtifactFailureCode

/** The result of storing a record's content in the artifact store. */
export type RecordContentStoreResult =
  | { readonly ok: true; readonly manifest: BlobManifest; readonly deduplicated: boolean }
  | {
      readonly ok: false
      readonly code: RecordContentFailureCode
      readonly message: string
    }

/**
 * Stores a package record's content bytes in the artifact store. The
 * resulting blob digest must equal the record's declared content digest —
 * a mismatch means the record is mis-sealed or malicious and fails closed.
 */
export function publishRecordToCas(
  artifacts: ArtifactStore,
  record: PackageRecord,
): RecordContentStoreResult {
  const bytes = packageRecordContentBytes(record)
  const expected = record.identity.contentDigest
  const actual = computeBlobDigest(bytes)
  if (actual !== expected) {
    return {
      ok: false,
      code: 'digest-mismatch',
      message: `record content hashes to ${actual} but the record declares ${expected} (mis-sealed or tampered record)`,
    }
  }
  const stored: StoreResult = artifacts.store(bytes, {
    mediaType: PACKAGE_RECORD_MEDIA_TYPE,
  })
  if (!stored.ok) {
    return { ok: false, code: stored.code, message: stored.message }
  }
  return { ok: true, manifest: stored.manifest, deduplicated: stored.deduplicated }
}

/** The result of resolving a content digest back to a record via the CAS. */
export type RecordFetchResult =
  | { readonly ok: true; readonly record: PackageRecord }
  | {
      readonly ok: false
      readonly code: RecordContentFailureCode
      readonly message: string
      readonly violations?: readonly RecordViolation[]
    }

/**
 * Resolves a package record by content digest through the artifact store:
 * fetch (integrity-verified by the store), parse, re-seal, verify the
 * digest equality and structurally validate. Returned records are deep
 * frozen, mirroring the registry's storage discipline.
 */
export function fetchRecordFromCas(
  artifacts: ArtifactStore,
  digest: ContentDigest,
): RecordFetchResult {
  const fetched = artifacts.fetch(digest)
  if (!fetched.ok) {
    return { ok: false, code: fetched.code, message: fetched.message }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(fetched.bytes))
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-record-content',
      message: `record content for ${digest} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const candidate = parsed as { identity?: unknown; metadata?: unknown }
  const unsealed = {
    identity: candidate?.identity as PackageRecord['identity'] | undefined,
    metadata: candidate?.metadata as PackageRecord['metadata'] | undefined,
  }
  if (unsealed.identity === undefined || unsealed.metadata === undefined) {
    return {
      ok: false,
      code: 'invalid-record-content',
      message: `record content for ${digest} does not carry identity and metadata`,
    }
  }
  const sealed = sealPackageRecord({
    identity: unsealed.identity,
    metadata: unsealed.metadata,
  })
  if (sealed.identity.contentDigest !== digest) {
    return {
      ok: false,
      code: 'digest-mismatch',
      message: `record content for ${digest} re-seals to ${sealed.identity.contentDigest}`,
    }
  }
  const violations = validatePackageRecord(sealed)
  if (violations.length > 0) {
    return {
      ok: false,
      code: 'invalid-record',
      message: `record for ${digest} failed structural validation: ${violations
        .map((violation) => `${violation.code} (${violation.message})`)
        .join('; ')}`,
      violations,
    }
  }
  return { ok: true, record: deepFreeze(sealed) }
}

/** One artifact-reference problem found by `verifyRecordArtifacts`. */
export interface ArtifactRefProblem {
  readonly code: 'artifact-missing' | 'artifact-size-mismatch' | 'artifact-media-type-mismatch'
  readonly message: string
  readonly digest: ContentDigest
  readonly packageId: string
}

/** The verdict of verifying a record's declared CAS artifact references. */
export interface RecordArtifactVerification {
  readonly ok: boolean
  readonly problems: readonly ArtifactRefProblem[]
}

/** Every CAS artifact reference a record declares (artifacts + notices). */
export function declaredArtifacts(record: PackageRecord): readonly CasArtifactRef[] {
  const casArtifacts = record.metadata.artifacts.filter(
    (artifact): artifact is CasArtifactRef => artifact.storage === 'cas',
  )
  const notices = record.metadata.license?.notices ?? []
  return [...casArtifacts, ...notices]
}

/**
 * Verifies that every CAS artifact a record declares is present in the
 * artifact store with the declared byte size (and media type when both
 * sides assert one). Presence + size only — full content verification is
 * the artifact store's fetch path (E7: no wholesale pulls during pin
 * verification).
 */
export function verifyRecordArtifacts(
  record: PackageRecord,
  artifacts: ArtifactStore,
): RecordArtifactVerification {
  const problems: ArtifactRefProblem[] = []
  for (const reference of declaredArtifacts(record)) {
    const stat = artifacts.stat(reference.digest)
    if (stat === null) {
      problems.push({
        code: 'artifact-missing',
        message: `artifact ${reference.digest} (${reference.mediaType}) declared by ${record.identity.id} is not present in the artifact store`,
        digest: reference.digest,
        packageId: record.identity.id,
      })
      continue
    }
    if (stat.sizeBytes !== reference.sizeBytes) {
      problems.push({
        code: 'artifact-size-mismatch',
        message: `artifact ${reference.digest} declared by ${record.identity.id} as ${reference.sizeBytes} bytes but stored as ${stat.sizeBytes} bytes`,
        digest: reference.digest,
        packageId: record.identity.id,
      })
    }
    if (stat.mediaType !== null && stat.mediaType !== reference.mediaType) {
      problems.push({
        code: 'artifact-media-type-mismatch',
        message: `artifact ${reference.digest} declared by ${record.identity.id} as ${reference.mediaType} but stored as ${stat.mediaType}`,
        digest: reference.digest,
        packageId: record.identity.id,
      })
    }
  }
  return { ok: problems.length === 0, problems }
}

/** One pin-level problem found by `verifyLockAgainstStores`. */
export interface LockPinProblem {
  readonly code:
    | 'missing-package'
    | 'digest-mismatch'
    | 'record-content-missing'
    | 'record-content-integrity'
    | 'record-content-invalid'
    | 'artifact-missing'
    | 'artifact-size-mismatch'
    | 'artifact-media-type-mismatch'
  readonly message: string
  readonly packageId: string
}

/** The per-pin verdict of lockfile verification against both stores. */
export interface LockPinVerification {
  readonly pin: LockedPackage
  readonly ok: boolean
  readonly problems: readonly LockPinProblem[]
}

/** The verdict of verifying a whole lockfile against both authorities. */
export interface LockStoreVerification {
  /** `true` only when every pin verifies AND graph resolution succeeds. */
  readonly pass: boolean
  readonly pins: readonly LockPinVerification[]
  /** The deterministic resolution over the registry snapshot (E9). */
  readonly resolution: ResolutionResult
}

function mapContentFailureCode(code: RecordContentFailureCode): LockPinProblem['code'] {
  if (code === 'unknown-digest') {
    return 'record-content-missing'
  }
  if (code === 'integrity') {
    return 'record-content-integrity'
  }
  return 'record-content-invalid'
}

/**
 * Verifies a lockfile against BOTH package authorities (lock rule 10):
 *
 * 1. registry — a record exists at each pinned coordinate with the pinned
 *    content digest;
 * 2. artifact store — the record's content bytes resolve through the CAS
 *    (fetch + integrity + re-seal equality), and every declared CAS
 *    artifact is present with the declared size/media type;
 * 3. graph — package-system resolution over the registry snapshot
 *    (dependency closure, cycles, capabilities, overlay targets).
 *
 * Pins are checked in canonical (id-sorted) order — deterministic.
 */
export function verifyLockAgainstStores(
  lock: PackageLock,
  deps: { registry: RegistryReadAccess; artifacts: ArtifactStore },
): LockStoreVerification {
  const pins = [...lock.packages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const pinVerdicts: LockPinVerification[] = pins.map((pin) => {
    const problems: LockPinProblem[] = []
    const record = deps.registry.get({
      kind: pin.kind,
      id: pin.id,
      version: pin.version,
    })
    if (record === null) {
      problems.push({
        code: 'missing-package',
        message: `pin ${pin.id}@${pin.version} is not published in the registry`,
        packageId: pin.id,
      })
      return { pin, ok: false, problems }
    }
    if (record.identity.contentDigest !== pin.contentDigest) {
      problems.push({
        code: 'digest-mismatch',
        message: `pin ${pin.id} expects digest ${pin.contentDigest} but the registry records ${record.identity.contentDigest}`,
        packageId: pin.id,
      })
      return { pin, ok: false, problems }
    }
    const content = fetchRecordFromCas(deps.artifacts, pin.contentDigest)
    if (!content.ok) {
      problems.push({
        code: mapContentFailureCode(content.code),
        message: content.message,
        packageId: pin.id,
      })
    }
    const artifactVerdict = verifyRecordArtifacts(record, deps.artifacts)
    for (const problem of artifactVerdict.problems) {
      problems.push({ code: problem.code, message: problem.message, packageId: problem.packageId })
    }
    return { pin, ok: problems.length === 0, problems }
  })

  const resolution = deps.registry.resolveLock(lock)
  const pass = pinVerdicts.every((verdict) => verdict.ok) && resolution.ok
  return { pass, pins: pinVerdicts, resolution }
}

/** The result of the `publishPackage` convenience. */
export type PublishPackageResult =
  | {
      readonly ok: true
      readonly cas: RecordContentStoreResult
      readonly registry: RegistryPublishResult
    }
  | {
      readonly ok: false
      readonly stage: 'artifact-verification' | 'cas' | 'registry'
      readonly message: string
      readonly problems?: readonly ArtifactRefProblem[]
      readonly detail?: RegistryPublishResult | RegistryStoreError
    }

/**
 * Fail-closed package publication: verify declared artifacts (present with
 * declared sizes), store the record's content bytes in the CAS, then
 * publish the record to the registry. Set `verifyArtifacts: false` for
 * staged uploads where artifacts are uploaded after the record (documented
 * opt-out; verification still happens at lock time).
 */
export async function publishPackage(
  record: PackageRecord,
  deps: { registry: PackageRegistry; artifacts: ArtifactStore },
  options: { verifyArtifacts?: boolean } = {},
): Promise<PublishPackageResult> {
  if (options.verifyArtifacts ?? true) {
    const verdict = verifyRecordArtifacts(record, deps.artifacts)
    if (!verdict.ok) {
      return {
        ok: false,
        stage: 'artifact-verification',
        message: `record ${record.identity.id} references CAS artifacts that are not verifiably present; publication fails closed`,
        problems: verdict.problems,
      }
    }
  }
  const cas = publishRecordToCas(deps.artifacts, record)
  if (!cas.ok) {
    return { ok: false, stage: 'cas', message: cas.message }
  }
  const registry = await deps.registry.publish(record)
  if (!registry.ok) {
    return {
      ok: false,
      stage: 'registry',
      message: `registry rejected the record: ${registry.message}`,
      detail: registry,
    }
  }
  return { ok: true, cas, registry }
}
