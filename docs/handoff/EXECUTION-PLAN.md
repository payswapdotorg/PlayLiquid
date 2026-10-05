# PlayLiquid GameOS Execution Plan

The program is a dependency DAG, not a fixed serial checklist.

## Dispatch policy

1. Run program:frontier.
2. Select up to three ready Work Orders with disjoint write surfaces.
3. Give each worker the exact Work Order and current base SHA.
4. Workers work independently.
5. Review worker evidence against actual Git diff.
6. Merge only accepted PRs.
7. Recompute frontier immediately.
8. Dispatch the next independent frontier items.

## Parallel tracks

Track A: semantic kernel → runtime → avatar → reference runtime.
Track B: package/CAS → build → engine/tool adapters → target builds.
Track C: platform services → integrity/economy/multiplayer → product integrations.
Track D: Lab contracts → simulation → organization search → learning → Arena.
Track E: UI/community → browser verification.
Track F: examples/performance/security/deployment.

Tracks run in parallel whenever their dependency edges permit.

## Shared surfaces

Root manifests, lockfiles, program state, architecture policy and central composition are serialized TL work.

## Merge rule

A worker branch is not green solely because its tests pass. The TL must verify:
- dependency prerequisites;
- changed paths;
- architecture checks;
- runtime behavior;
- required browser/deployment evidence;
- no scope leakage.

## Architecture-change rule

When a worker finds a missing or contradictory architecture boundary, stop the affected path and raise an Architecture Change Request. Do not create a parallel authority to escape the problem.
