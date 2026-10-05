# @playliquid/platform-contracts

Work Order PL-004 — Platform capability contracts (PlayLiquid GameOS).

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
node --test "src/*.test.ts"     # 112 tests (see environment note below)
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
