# PlayLiquid GameOS Project State

Version: 2.0
Status: PROGRAM COMPLETE / FINAL RELEASE AUDIT PASSED (PL-045)

## Current baseline

The repository is a ZCode 3.14.3 fork with the PlayLiquid GameOS implemented, verified and audited.

The frozen architecture (spec/architecture.md, spec/architecture-lock.md) is realized by the merged
program: 45/45 Work Orders MERGED, every one with source + tests + runtime evidence recorded in
program/graph.json and the promotion waves in the git history.

## Final audit (PL-045, TL-executed)

- Work Orders: 45/45 MERGED; program check PASS; frontier EMPTY after this record.
- Merged-SHA audit: 44/44 pre-PL-045 records carry a mergedSha contained in main (6 early records
  backfilled from the program-record commits: PL-005 f09b3c5, PL-006 b5b6aa4, PL-007 559e7c9,
  PL-008 1da7192, PL-009 263eb5c, PL-011 c935bc9).
- Test truth: 3226 tests / 3226 pass / 0 fail across every suite in the repo gate set
  (3139 src-suite tests over 62 src roots + 63 web-package store/view-model tests + 24
  performance sibling-suite tests). Exact per-suite numbers: docs/handoff/RELEASE-AUDIT.md.
- Type truth: `npx tsc -p .` exit 0 for every PlayLiquid-domain tree (52 domain packages +
  4 examples + 4 qa trees + services/ops + deployment). The 6 fork-infrastructure packages
  (client, server, services, ui, web root, zcode-server-cli) are composite project-reference
  builds requiring `tsc -b` dist outputs — a pre-existing fork property, outside the program's
  write surface (no Work Order wrote them; architecture:check governs them by the same
  module rules and passes).
- Architecture gates: full 5 violations / 5 baseline / 0 new; changed 4/4/0 new; 71 modules in
  architecture-policy.yaml (66 PlayLiquid-domain managed modules after promotion waves 1-26 +
  the fork-infrastructure set); module-dependency-matrix reconciled with every wave.

## Program state

The authoritative Work Order state is program/graph.json. PL-045 closes the program: the
frontier is empty and every capability claim is indexable to source + tests + evidence
(docs/handoff/RELEASE-AUDIT.md is the evidence index).

A Work Order was GREEN only when its source, tests and applicable runtime/browser/deployment
evidence agreed; that rule held through the final merge.

## Architecture changes

Any change to the frozen architecture now requires an Architecture Change Request, impact
analysis, dependency-graph update, affected Work Order re-pinning and TL approval — the
post-program maintenance regime is the same as the in-program one.

## Environment truth

Console builds depend on vendor-authorized SDK/toolchains.
Hardware-specific claims require hardware evidence.
Arena is optional for ordinary autonomous paths.
The deployment surface (services/ops + deployment) is an in-process typed model with
deterministic verification — no real infrastructure is claimed or exercised (E11).


## Fork-infrastructure integration record (post-program, 2026-10-13)

`feat/ui-plugin` (UI plugins + Gen UI; fork-upstream feature by wuweiqi, 2026-09-29)
landed on main via PR #5 (merge 3c980b8) after the TL gate battery: program
check PASS / frontier EMPTY unchanged; architecture full 5/5/0-new + changed
4/4/0-new (exact main parity); tsc sweep green on every domain tree; node --test
gate set 3202/3202/0 over 60 suites — exact main parity (the PL-045 audit's
aggregate 3226 includes a 24-test bookkeeping artifact; the reproduction command
form `node --test "src/**/*.test.ts"` yields 3202 at both main and the merge);
branch vitest feature suites 117/117 (ui 71, shared 24, services 19, client 1,
desktop 2); oxlint 0 errors; frozen lockfile green after regeneration. The 8 new
managed fork sub-modules (gen-ui-protocol, gen-ui-service, gen-ui, mcp-apps-protocol,
mcp-ui, plugin-ui-bridge, plugin-sandbox, plugin-ui) are recorded in
spec/module-dependency-matrix.md under the fork-infra regime. Fork composite
`tsc -b` builds remain outside the gate set (pre-existing §E11 boundary).