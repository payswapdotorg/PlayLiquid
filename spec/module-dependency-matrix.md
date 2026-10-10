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
| capability-broker | @playliquid/capability-broker | Runtime | runtime-contracts, game-ir (runtime-contracts pinned by work order — the frozen capability protocol the broker operates) |
| avatar-runtime | @playliquid/avatar-runtime | Runtime | game-contracts, game-ir, capability-broker, runtime-contracts (game-contracts justified: frozen R5 vocabulary) |
| tool-fabric-runtime | @playliquid/tool-fabric-runtime | Tools | tool-fabric, engine-adapter-contract (adapter seam) |
| platform-identity | @playliquid/platform-identity | Platform | platform-contracts |
| platform-social | @playliquid/platform-social | Platform | platform-contracts, game-ir |
| platform-leaderboard | @playliquid/platform-leaderboard | Platform | platform-contracts |
| platform-achievements | @playliquid/platform-achievements | Platform | platform-contracts |
| platform-economy | @playliquid/platform-economy | Platform | platform-contracts (integrity consumed as PORT — the RewardIntegrityPort seam, PL-018 wires later) |
| platform-integrity | @playliquid/platform-integrity | Platform | platform-contracts, replay, runtime-contracts (platform-contracts justified: frozen integrity vocabulary; recorded in module.ts requires) |
| community | @playliquid/community | Product | git-lineage, game-ir, platform-contracts, package-system (design-intent row + typed transitive vocabulary of lineage coordinates) |
| lab-simulation | @playliquid/lab-simulation | Lab | lab-contracts, simulation, replay, avatar-runtime, capability-broker, game-contracts, game-ir, runtime-contracts, platform-contracts, package-system (PL-028; game-contracts/platform-contracts/package-system/game-ir/runtime-contracts justified per module.ts — frozen vocabulary, tenant isolation, canonical JSON authority, world value language, session/actor/command vocabulary) |

## Design intent (work orders not yet merged)

| Module | Owner | Main dependency |
|---|---|---|
| sensory-runtime | Runtime | avatar-runtime |
| build-orchestrator | Build | build-contracts, tool-fabric-runtime |
| game-ui | Product | public contracts/read models |

Rules:
- managed modules expose only public contracts;
- domain is pure;
- app orchestrates through ports;
- adapters own IO/tool/engine details;
- UI never imports implementation modules.
