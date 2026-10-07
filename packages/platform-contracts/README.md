# @playliquid/platform-contracts

Work Order PL-004 — Platform capability contracts (PlayLiquid GameOS).
Refined by Work Order PL-009 — integrity/economy/replay contract
refinement (see "PL-009 refinement areas" below).

The typed capability surface of every GameOS platform service (R7, lock
rule 17): leaderboard, multiplayer, replay, rewards, achievements,
social, analytics, moderation and integrity. Pure TypeScript types and
pure functions only: no IO, no storage, no service implementations
(those are PL-015..PL-018). The only dependency is the workspace
sibling `@playliquid/game-contracts` (module-dependency-matrix).

## Contract areas

| Area | Module | Anchors |
| --- | --- | --- |
| Branded primitives, authority marker | `src/primitives.ts` | nominal ids, caller-supplied time |
| Semantic event vocabulary | `src/events.ts` | lock 18 — game-declared vs platform-authority events, reserved `platform.` namespace |
| Tenant isolation + least privilege | `src/tenancy.ts` | R20, phantom tenant tags, default deny |
| Leaderboard | `src/leaderboard.ts` | R7, platform-owned ranking, untrusted score claims |
| Multiplayer | `src/multiplayer.ts` | R7/R9, lock 19, admission + outcome authority |
| Replay | `src/replay.ts` | R7/R8, lock 15, sealed artifacts, consumer access |
| Entitlements / economy | `src/entitlements.ts` | R10, idempotent grants, ledger fold, lock 41 |
| Achievements | `src/achievements.ts` | R7, platform-marked unlocks |
| Social | `src/social.ts` | R7, consent + graph capacity |
| Analytics | `src/analytics.ts` | R7, per-event privacy classes, forbidden payload keys |
| Moderation | `src/moderation.ts` | R7, E8 typed negative paths, severity-scaled evidence |
| Competitive integrity | `src/integrity.ts` | R7/R11/E11, confidence intervals, evidence refs, forbidden certainty fields |
| Cross-capability rules | `src/policy.ts` | lock 18/19/41, R20 — `validateCapabilityPolicy` |

## PL-009 refinement areas (additive)

| Area | Module | Anchors |
| --- | --- | --- |
| Behavioral evidence records | `src/integrity-evidence.ts` | R11/E11 — digest-pinned opaque payloads, frozen trajectory/timing/outcome-pattern kinds, id+digest citations |
| Integrity risk verdicts | `src/integrity-verdicts.ts` | R11 — frozen verdict vocabulary, width-derived confidence bands, `isBot`/`isHuman` unrepresentable (`FORBIDDEN_VERDICT_FIELDS`) |
| Participation-mode declarations | `src/participation.ts` | explicit AI-player modes — disjoint `participation.*` markers, lossless map onto `AiPlayMode` |
| Policy-driven enforcement | `src/integrity-enforcement.ts` | evidence-before-enforcement; decisions cite policy id + verdict + evidence ids; proportionate action vocabulary |
| Entitlement lifecycle | `src/entitlement-lifecycle.ts` | R10 — frozen `granted → held → settled/revoked` state machine, idempotency keys on every command, stale-result rule |
| Economy value carriers | `src/economy-values.ts` | zero numeric authority — opaque digests or typed kernel-value readings (game-ir ValueShape pinned by digest, projected kinds only) |
| Entitlement settlement | `src/settlement.ts` | R10 — settlement eligibility declarations, typed validation verdicts, append-only settlement records with audit references |
| Replay reuse lanes | `src/replay-lanes.ts` | R8 — per-lane request shapes (player/QA/integrity/simulation/lab), typed views over the ONE canonical descriptor, lane-scope oracle |
| Replay provenance | `src/replay-provenance.ts` | R8 — digest-pinned linkage to authoritative session/runtime records; never re-declares session state |
| QA assertions | `src/qa-assertions.ts` | R8 — expectation records over pinned replays; honest `inconclusive` outcomes; evidence digest mandatory |
| Refinement barrel | `src/refinements.ts` | explicit PL-009 re-export list (root `index.ts` star-exports it to stay under the 400-line budget) |

PL-009 design notes:

- Every PL-004 export keeps its name and shape; refinements are new
  modules plus new entries in the test/harness wiring.
- The `KernelValueKind` union in `economy-values.ts` is a read-only
  projection of game-ir's ValueShape primitive vocabulary (the shape
  language itself is NOT re-declared; this package cannot import
  game-ir per the module matrix). If game-ir's primitives change, the
  projection follows via Architecture Change Request.
- `decideEnforcement` returns `no-matching-rule` (a typed refusal)
  when no policy rule fires: policy totality is an explicit authoring
  choice, never a silent default.

## Lock-rule enforcement summary

- **Lock 18** (games declare, they do not duplicate platform
  authorities): `GameDeclaredEvent` and `PlatformAuthorityEvent` are
  structurally disjoint (origin literals + branded vs frozen-literal
  kinds — `@ts-expect-error` tests in `events.test.ts`);
  `asGameEventKind` refuses to mint reserved `platform.*` kinds; the
  policy validator rejects them with `reserved-platform-event-kind`.
- **Lock 19 / R9** (outcomes authoritative outside the untrusted
  client): `PlatformOutcomeRecord` demands the authority marker, an
  evidence chain and dense ranks; client claims carry the
  `untrusted-client-input` marker and are never assignable;
  competitive peer-to-peer topologies with protected bindings are
  refused by the policy validator.
- **Lock 41 / R10** (no client-authoritative rewards): grants settle
  idempotently (`duplicate-grant`, `idempotency-collision` refusals);
  reward rules structurally require authoritative outcomes.
- **R11 / E11** (probabilistic integrity evidence, never certainty):
  every quantitative statement is a bounds-verified
  `ConfidenceInterval`; signals must cite replay/QA/telemetry evidence;
  verdict-shaped fields make a report invalid.
- **R20** (tenant isolation, least privilege): phantom tenant tags give
  compile-time cross-tenant rejection; runtime oracles
  (`checkTenantIsolation`, `checkLeastPrivilege`) are default deny.
- **E8** (negative paths mandatory): every oracle has typed refusal
  codes with dedicated tests.

## Gates

```bash
cd packages/platform-contracts
npx tsc -p .                    # typecheck
node --test "src/*.test.ts"     # all colocated tests (PL-004 baseline + PL-009 refinement)
node src/harness.ts             # pure-check runtime evidence (synthetic policy)
npx oxlint packages/platform-contracts   # from repo root
```

Environment notes (recorded honestly; see the Work Order LIMITATIONS):

- Node 24.21's test runner treats `node --test <dir>` arguments as
  files/globs, not searchable directories (`node --test src/` prints
  "Could not find 'src/'"); `node --test "src/*.test.ts"` is the
  equivalent working form for "all tests under src/". The same
  environment note is recorded by PL-003
  (`packages/runtime-contracts/README.md`).
- The package's `test` script uses the working glob form; the Work
  Order's literal `node --test src/` gate fails on this Node version
  for every workspace package, including the already-merged Wave 1
  packages.

## Import rule

This package imports `@playliquid/game-contracts` directly through the
pnpm workspace link (`workspace:*` dependency). It does NOT import
`@playliquid/runtime-contracts`: session-internal authority machinery
(claims, epochs, committed-event evidence chains) is owned by PL-003
and is bound at the implementation layer by PL-016
(`packages/platform-multiplayer`), per spec/module-dependency-matrix.md
(platform-contracts | game-contracts).
