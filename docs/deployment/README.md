# PlayLiquid deployment & operations (PL-044)

This directory documents the deployment/operations surface of the repo:
the **services/ops** tree (the operations service) and the
**deployment** tree (the deployment truth). Read this index first; each
focused doc covers one contract.

## What these trees ARE (E11 honesty)

- **In-process services over injected ports** — pure TypeScript, no IO
  beyond the injected seams, no timers (clocks are injected), no
  randomness (content is seeded). Tests run under plain `node --test`
  with TS type-stripping.
- **A typed deployment model, deterministic verifier and append-only
  journal** — a `DeploymentPlan` is service units pinned to PL-011
  content digests; the verifier refuses what does not prove out and
  seals what does (E9); the journal records, never edits (E10).
- **Durable-queue semantics with exactly-once effects under
  crash-resume** (E6) — verified by fault injection at every durable
  point, not by trusting the code.

## What these trees are NOT (E11 honesty, stated plainly)

- **No real infrastructure**: no processes are spawned, nothing listens
  on a socket, there is no network anywhere in the tree.
- **No containers, no Kubernetes, no scheduler**: the "deployment" is a
  typed model verified in-process; the manifest
  (`deployment/manifests/deployment-plan.json`) is evidence produced by
  the deterministic corpus, not a deployable artifact for a real
  orchestrator.
- **No secrets management**: no credentials are read, stored or
  simulated.
- A **real** deployment would bind the SAME contracts (the registry/CAS
  doors, the profile source, the worker store/effects ports, the health
  gates) to real infrastructure. The contracts in these trees are the
  honest, verified seam such a binding would target.

## Document index

| Doc | Covers |
| --- | --- |
| [durable-worker.md](./durable-worker.md) | The durable worker runtime: crash/resume/exactly-once semantics, the F1–F8 fault rows by name |
| [health-readiness.md](./health-readiness.md) | The health/readiness contract: UP/DOWN/DEGRADED gates over real service doors, liveness as journal freshness |
| [deployment-model.md](./deployment-model.md) | The deployment model + verifier walkthrough: artifact pins, R19 provenance, R20 rights, the seal, the journal, the committed manifest |
| [web-host-mount.md](./web-host-mount.md) | The web host mount recipe (PL-033/034): composing the Studio/Lab/Community workbenches as one typed host document |
| [running.md](./running.md) | How to run everything: type-check, tests, lint, architecture gates |

## The trees at a glance

```
services/ops/            the operations service (tsconfig-only tree, no package.json)
  src/worker.ts           THE durable worker runtime (E6) — single mutable-state owner (E1)
  src/worker-lease.ts     lease fold: expiry, renewal, due-ordering
  src/worker-restore.ts   layered restore verification (tampered content never adopts)
  src/work-journal.ts     the append-only work journal (E10), hash-chained
  src/worker-ports.ts     the injected ports: clock, store, effects (the host contract)
  src/health.ts           the health/readiness vocabulary + rollup + liveness
  src/health-bindings.ts  gates bound over the REAL package doors
  src/web-host.ts         the PL-033/034 mount contract as one typed host document
  src/fixtures.ts         TEST-SUPPORT doubles (clearly labeled; never production)
deployment/              the deployment truth (tsconfig-only tree, no package.json)
  src/model.ts            the typed DeploymentPlan model + structural guards
  src/verifier.ts         THE verifier: typed refusals + the content-addressed seal (E9)
  src/journal.ts          the append-only deployment journal (E10)
  src/corpus.ts           the deterministic honest-topology corpus (7 units)
  src/manifest.ts         the committed-manifest generator + re-verification door
  src/fixtures.ts         TEST-SUPPORT hostile doubles (relaxed registry, lying doors)
  manifests/deployment-plan.json   the committed verified-plan evidence
docs/deployment/         this documentation
```

## Requirement traceability

| Requirement | Where it is proven |
| --- | --- |
| E6 durable/queued/resumable work | `services/ops` worker tests: F1–F8 crash matrix (see [durable-worker.md](./durable-worker.md)) |
| E8 negative tests | `services/ops` health/door/restore tests; `deployment/src/negative.test.ts` (the R1–R5 rows) |
| E9 determinism | run-twice identical digests/seals/journals in both trees; the committed manifest regenerates byte-identically |
| E10 append-only history | the work journal (chained digests) and the deployment journal (edit doors refuse) |
| E11 honest limits | every file header; the all-false environment truth verified structurally |
| R7 platform services | the honest topology's platform-service units + the ops health gates over them |
| R19 provenance as a release gate | the deployment verifier re-runs package-system's release gate itself (see [deployment-model.md](./deployment-model.md)) |
| R20 tenant isolation | tenancy oracles at every door; tenant-scoped plans, units and grants; cross-tenant scope is a typed refusal |
