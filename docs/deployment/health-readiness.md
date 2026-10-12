# The health/readiness contract (services/ops, PL-044)

`services/ops/src/health.ts` + `health-bindings.ts` define the
operations tree's health surface. Deployment plans cite these doors (see
[deployment-model.md](./deployment-model.md)).

## Readiness = dependency gates over REAL service doors

Each gate probes ONE real door of ONE real dependency and classifies the
door's typed answer. The door vocabulary is FROZEN (`OPS_HEALTH_DOORS`) —
it is exactly the set deployment units may cite:

| Door | The real dependency behind the gate |
| --- | --- |
| `package-registry` | a package-registry index lookup (canary record resolves + its sealed digest verifies) |
| `artifact-cas` | an artifact-store CAS fetch (fail-closed integrity) |
| `build-orchestrator` | the build-orchestrator's own content-addressed snapshot verification |
| `rights-authority` | the security-gameos authority decides a canary request + its state snapshot door answers |
| `platform-economy` | the economy service's snapshot door |
| `platform-integrity` | an integrity standing read |
| `ops-worker-journal` | the durable worker's own journal freshness (E10) |
| `web-host-composition` | the web host composition document verifies |

Each gate returns one of three statuses:

- **UP** — the door answered its healthy answer.
- **DEGRADED** — the door answered with an honest soft signal (e.g. an
  integrity standing that was never recorded — an absence, not a
  failure; never a fake pass).
- **DOWN** — the door refused in a way that means the dependency is
  broken (tampered digests, corrupted blobs, malformed documents). The
  dependency's refusal code surfaces VERBATIM in the gate result.

The readiness rollup is total and never throws: any DOWN gate makes the
whole report DOWN; else any DEGRADED gate makes it DEGRADED; else UP. A
gate whose probe THROWS is itself a typed DOWN gate (`probe-threw`) — a
dependency crash is never a silent pass.

## Liveness = journal freshness (E10)

Liveness is NOT a second probe set: the runtime is alive when its
append-only work journal is advancing. The liveness read reports UP
while the journal is non-empty and its last entry is within the
host-declared `maxAgeMs` bound of the injected now; DOWN when stale or
empty (an empty journal means the runtime has never durably done
anything).

## What the tests prove (13 gates, E8/E9/E10)

- every gate over the REAL bound doors rolls up UP;
- the readiness report is deterministic — run twice, identical (E9);
- an unknown CAS digest is a typed DOWN with the store's refusal code
  verbatim; a corrupted blob surfaces the integrity code verbatim; a
  tampered registry canary surfaces `digest-mismatch`; an unresolvable
  canary surfaces `missing-canary`; a tampered build-orchestrator
  snapshot surfaces the snapshot's own code — never a silent pass (E8);
- the rollup logic (any DOWN ⇒ DOWN; DEGRADED alone ⇒ DEGRADED);
- an honest absence is DEGRADED, never a fake UP (the integrity door
  with no recorded verdict);
- a throwing probe is a typed DOWN (`probe-threw`);
- liveness is journal freshness — UP when fresh, DOWN when stale or
  empty, with typed codes for stale/empty journals;
- a tampered web host document is a typed DOWN with the composition's
  refusal code verbatim.

## Honest limits (E11)

The gates are synchronous, in-process calls into the dependencies' own
public doors — there is no HTTP health endpoint, no port scanning, no
process supervision. A real host exposes the same typed report (or its
rollup) through whatever liveness/readiness surface it has; the
`ReadinessReport` and `LivenessReport` are the contract.
