# The deployment model + verifier walkthrough (deployment/, PL-044)

The `deployment/` tree is the repo's deployment TRUTH: a typed
DeploymentPlan model, a deterministic verifier, an append-only
deployment journal, and one committed verified-plan manifest as
evidence. It is a tsconfig-only tree (the qa/browser precedent — no
package.json, no workspace importer).

## The model (`model.ts`)

A `DeploymentPlan` names a tenant, a submitting subject (the tenant's
rights-admin, R20) and SERVICE UNITS. Every unit pins exactly what the
verifier can check:

| Field | What it pins | Authority |
| --- | --- | --- |
| `artifactDigest` | a PL-011 package-registry/artifact-store content digest (`sha256:<64 hex>`) — no floating tags, no "latest" | package-system / package-registry / artifact-store |
| `target` | a target id from the FROZEN target taxonomy (web, spark, windows, macos, linux, android, ios, steamdeck, xr, dedicated-server, console) | target-profiles (PL-008), the taxonomy PL-036's target-builds resolves against |
| `healthGates` | readiness dependency declarations citing the frozen services/ops door vocabulary | services/ops `OPS_HEALTH_DOORS` |
| `rightsScope` | the least-privilege platform grants the unit's service identity holds (tenant, subject, capability ∈ the frozen R7 vocabulary, permissions ∈ read/submit/administer) | platform-contracts' `ScopedCapabilityGrant` — the exact shape security-gameos' platform lattice arm consumes |
| `truth` | the all-false environment truth (no real infrastructure, network, containers, secrets management) | E11 — structural, verified |

Provenance (R19) is deliberately NOT a plan field: it is carried by
the ARTIFACT RECORD behind the pinned digest and enforced by the
verifier's own release-gate leg (below). Units have kinds (`ops-service`,
`web-host`, `platform-service`) and every unit is tenant-scoped to the
plan's tenant.

## The verifier (`verifier.ts`)

`verifyDeploymentPlan(plan, { doors, clock })` — total, never throws,
mutates nothing. The doors are host-injected: the registry read seam
(`getByDigest`), the CAS (artifact-store itself) and the PL-036 target
profile source. In order:

1. **Shape + honesty**: non-empty ids/tenant/units; the all-false truth
   or a typed `honesty-violation` (E11).
2. **Submitter authorization (R20)**: security-gameos' own role oracle
   (`checkRightsRole`) must confirm the submitting subject is the
   tenant's `rights-admin` — `not-authorized` / `cross-tenant-request`
   verbatim.
3. **Per unit, per check**:
   - **Tenant isolation**: the platform-contracts isolation oracle
     confirms the unit belongs to the plan's tenant and every grant
     belongs to the unit's tenant (`cross-tenant-scope`, R20).
   - **Health gates**: every gate cites a known services/ops door
     (`unknown-health-door`), no duplicates, at least one.
   - **Target + profile**: the target is in the frozen taxonomy
     (`unknown-target`); the profile bundle passes target-builds' own
     fail-closed `verifyProfileBundle` (its `profile-unavailable` /
     `profile-invalid` codes verbatim, seal-checked).
   - **Rights scope**: every grant is structurally in the lattice
     (`isScopedCapabilityGrant` — `invalid-rights-scope`); then each
     (subject × capability × permission) is adjudicated through
     security-gameos' PURE LATTICE FOLD (`adjudicate`, the platform
     arm) over the unit's declared grants — a refusal surfaces as
     `rights-not-granted` with the lattice's code verbatim. The other
     lattice arms' inputs are empty by construction: a deployment plan
     declares only platform capabilities.
   - **Artifact truth (PL-011)**: the pinned digest must resolve through
     the REGISTRY to a sealed record that still matches its content
     digest (`unknown-artifact` / `tampered-artifact`), AND through the
     CAS via package-registry's own `fetchRecordFromCas` (fetch → parse
     → re-seal → digest equality → structural validation —
     `artifact-unavailable` with its code verbatim), AND both
     authorities must agree on the content (`artifact-mismatch`).
   - **Provenance (R19)**: the verifier re-runs package-system's release
     gate ITSELF (`checkReleaseGate`) on the resolved record —
     `license-missing`, `license-unverified`, `provenance-incomplete`,
     `model-provenance-missing` surface verbatim. This is the R19 point:
     provenance is a DEPLOYMENT gate, never a trust in the registry's
     admission policy. (The negative corpus proves it with
     package-registry's documented `enforceReleaseGate: false` opt-out:
     a relaxed index that admits an unlicensed record still cannot
     smuggle it through the verifier.)
4. **The seal (E9)**: a verified plan gets a content-addressed seal —
   the domain-separated digest over `{ verifier id, plan digest, unit
   count, verifiedAt }` under the injected clock. Same plan + same
   instant ⇒ identical seal, run twice (tested). A different instant
   seals differently (the instant is part of the content).

## The journal (`journal.ts`, E10)

Deployments are records, never edits. Every verification outcome (verified
or refused) appends one hash-chained journal entry; re-recording the
same seal is an idempotent duplicate receipt that grows nothing; the
service's `amendEntry` door refuses by construction (`journal-immutable`);
the pure chain verifier refuses edited, removed, reordered or re-minted
entries (`broken-chain` / `broken-sequence`); restore adopts only a
fully verifying chain.

## The committed manifest (`manifests/deployment-plan.json`)

ONE example verified plan manifest for this repo's honest topology —
7 units: the ops service, the web host composition, and the platform
services behind the ops health doors (registry+CAS, build-orchestrator,
rights authority, economy, integrity). It is generated DETERMINISTICALLY
from the corpus (sealed records, sealed profile bundles, the fixed
instant `DEPLOYMENT_MANIFEST_INSTANT`) and committed as evidence. The
manifest tests prove:

- the committed manifest re-verifies through the REAL doors (the plan
  is re-run, never trusted from the file);
- the committed seal re-derives at its recorded instant (E9);
- regeneration reproduces the committed file BYTE-FOR-BYTE (E9, run
  twice);
- tampering the file (plan edit, seal edit, honesty lie, version lie,
  unresolvable artifact pin) is a typed refusal, never a silent pass.

## The negative corpus (E8, mandatory rows)

`negative.test.ts` proves each row as a typed refusal that mutates
nothing (the good plan still verifies through the same doors after
every refusal):

| Row | Hostile move | Typed refusal |
| --- | --- | --- |
| R1 | tampered artifact digest (one flipped hex char) | `unknown-artifact` |
| R1′ | a lying registry door resolving a tampered record | `tampered-artifact` |
| R2 | unverified license / empty transformation history / undisclosed AI generation | `license-unverified` / `provenance-incomplete` / `model-provenance-missing` (R19 verbatim) |
| R2′ | a record with literally NO license | cannot even be admitted — the registry refuses `invalid-record` structurally |
| R3 | a unit of another tenant; a foreign-tenant grant; an unauthorized submitter | `cross-tenant-scope` (×2) / `not-authorized` + `cross-tenant-request` |
| R4 | unknown readiness door (also empty/duplicated gate lists) | `unknown-health-door` / `invalid-plan` / `duplicate-health-door` |
| R5 | journal edit attempts (amend, edit, remove, re-mint) | `journal-immutable` / `broken-chain` / `broken-sequence` |
| + | off-taxonomy target; unpublished profile; rights outside the lattice; network-claiming plan | `unknown-target` / `profile-unavailable` / `invalid-rights-scope` / `honesty-violation` |

## Honest limits (E11)

The verifier verifies in-process against host-injected doors; the
committed manifest is typed-model evidence, not a deployable artifact.
There is no real infrastructure, no network, no containers, no
Kubernetes and no secrets management anywhere in this tree — a real
deployment binds the same doors to real authorities and the same
contracts hold.
