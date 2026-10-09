# PlayLiquid GameOS Module Dependency Matrix

Ground truth for implemented modules: the `dependencies` field of each package
manifest, mirrored in `architecture-policy.yaml` `requires` (PL-010 governance
promotion). Rows for not-yet-implemented work orders remain design intent.

## Implemented and promoted (managed: true)

| Module | Package | Owner | Actual dependencies (workspace) |
|---|---|---|---|
| game-contracts | @playliquid/game-contracts | GameOS | (pure — ZCode-shared seams only, no workspace deps) |
| game-ir | @playliquid/game-ir | GameOS | game-contracts |
| package-system | @playliquid/package-system | GameOS | (pure) |
| runtime-contracts | @playliquid/runtime-contracts | Runtime | (pure) |
| platform-contracts | @playliquid/platform-contracts | Platform | game-contracts |
| tool-fabric | @playliquid/tool-fabric | Tools | (pure) |
| engine-adapter-contract | @playliquid/engine-adapter-contract | Tools | (pure) |
| lab-contracts | @playliquid/lab-contracts | Lab | game-contracts, game-ir |
| arena-integration | @playliquid/arena-integration | Integration | game-contracts |
| build-contracts | @playliquid/build-contracts | Build | game-ir, package-system |
| target-profiles | @playliquid/target-profiles | Build | game-ir, runtime-contracts |
| artifact-store | @playliquid/artifact-store | Platform | package-system |
| package-registry | @playliquid/package-registry | Platform | artifact-store, package-system |
| git-lineage | @playliquid/git-lineage | GameOS | game-ir, package-system |
| runtime-core | @playliquid/runtime-core | Runtime | runtime-contracts |
| simulation | @playliquid/simulation | Simulation | game-contracts, game-ir, runtime-contracts |
| replay | @playliquid/replay | Platform | game-contracts, game-ir, package-system, runtime-contracts |
| platform-multiplayer | @playliquid/platform-multiplayer | Platform | platform-contracts, runtime-contracts |

## Design intent (work orders not yet merged)

| Module | Owner | Main dependency |
|---|---|---|
| capability-broker | Runtime | game-ir |
| avatar-runtime | Runtime | game-ir, capability-broker, runtime-contracts |
| sensory-runtime | Runtime | avatar-runtime |
| leaderboard | Platform | platform-contracts |
| economy | Platform | platform-contracts, integrity |
| integrity | Platform | replay, runtime-contracts |
| social | Platform | platform-contracts, game-ir |
| build-orchestrator | Build | build-contracts, tool-fabric-runtime |
| tool-fabric-runtime | Tools | tool-fabric |
| community | Product | git-lineage, game-ir |
| game-ui | Product | public contracts/read models |

Rules:
- managed modules expose only public contracts;
- domain is pure;
- app orchestrates through ports;
- adapters own IO/tool/engine details;
- UI never imports implementation modules.
