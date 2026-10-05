# PlayLiquid GameOS Module Dependency Matrix

| Module | Owner | Main dependency |
|---|---|---|
| game-contracts | GameOS | ZCode shared/RPC seams |
| game-ir | GameOS | game-contracts |
| package-system | GameOS | game-ir |
| provenance | GameOS | package-system |
| git-lineage | GameOS | package-system, game-ir |
| capability-broker | Runtime | game-ir |
| runtime-contracts | Runtime | game-ir |
| runtime-core | Runtime | runtime-contracts, capability-broker |
| simulation | Simulation | runtime-contracts, game-ir |
| replay | Platform | runtime-contracts, package-system |
| platform-contracts | Platform | game-contracts |
| multiplayer | Platform | platform-contracts, runtime-contracts |
| leaderboard | Platform | platform-contracts |
| economy | Platform | platform-contracts, integrity |
| integrity | Platform | replay, runtime-contracts |
| social | Platform | platform-contracts, game-ir |
| tool-fabric | Tools | game-contracts |
| build-contracts | Build | game-ir, package-system |
| build-orchestrator | Build | build-contracts, tool-fabric |
| spark | Build | runtime-contracts, build-contracts |
| avatar-runtime | Runtime | game-ir, capability-broker, runtime-contracts |
| sensory-runtime | Runtime | avatar-runtime |
| lab-contracts | Lab | game-contracts, game-ir |
| lab-simulation | Lab | lab-contracts, simulation |
| lab-organization | Lab | lab-contracts, capability-broker, lab-simulation |
| lab-learning | Lab | lab-simulation, lab-organization |
| arena-integration | Integration | lab-contracts, capability-broker |
| community | Product | git-lineage, game-ir |
| game-ui | Product | public contracts/read models |

Rules:
- managed modules expose only public contracts;
- domain is pure;
- app orchestrates through ports;
- adapters own IO/tool/engine details;
- UI never imports implementation modules.
