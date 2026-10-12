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
| tool-blender | @playliquid/tool-blender | Tools | engine-adapter-contract, tool-fabric-runtime, tool-fabric, platform-contracts (PL-025; platform-contracts justified per module.ts — TenantId/SubjectId tenant-isolation vocabulary, platform-economy/lab-simulation precedent, R20 cross-tenant discipline) |
| game-ui | @playliquid/game-ui | Product | package-system, runtime-core, runtime-contracts, tool-fabric-runtime, avatar-runtime, capability-broker, game-contracts (PL-033; per module.ts — read-model projections of authoritative public contracts only; runtime-contracts/game-contracts declared directly and deliberately: branded primitives + frozen R5 restriction vocabulary, avatar-runtime manifest precedent; peer-react provided by the host web app) |
| sensory-runtime | @playliquid/sensory-runtime | Runtime | avatar-runtime, game-contracts, game-ir, runtime-contracts, platform-contracts, package-system, capability-broker (PL-027; capability-broker justified per delivery report — harness driver-cycle seam + perception tests, avatar-runtime manifest precedent; platform-contracts/package-system per module.ts — TenantId tenant isolation, canonical JSON envelope keys, community/lab precedent) |
| build-orchestrator | @playliquid/build-orchestrator | Build | build-contracts, engine-adapter-contract, package-registry, package-system, target-profiles, tool-fabric, tool-fabric-runtime (PL-020; per module.ts — requires mirrors the package manifest's workspace deps exactly; engine-adapter-contract declared for the fake-adapter test seam, module.ts documents it; all pre-registered managed modules) |
| engine-playcanvas | @playliquid/engine-playcanvas | Tools | build-contracts, engine-adapter-contract, platform-contracts, target-profiles, tool-fabric, tool-fabric-runtime (PL-021; per module.ts — tool-fabric-runtime is the registration host, engine-adapter-contract the neutral Adapter seam it implements, tool-fabric the provider-neutral operation vocabulary; target-profiles + build-contracts compose the typed web-first engine binding (web/spark) per the delivery report; platform-contracts for TenantId/SubjectId isolation vocabulary — tool-blender/lab-simulation precedent, R20; all pre-registered managed modules) |
| engine-unreal | @playliquid/engine-unreal | Tools | build-contracts, engine-adapter-contract, platform-contracts, target-profiles, tool-fabric, tool-fabric-runtime (PL-022; per module.ts — same family row as engine-playcanvas: registration host + neutral seam + operation vocabulary + engine-binding composition; binding declares the desktop-class set windows/macos/linux per the delivery report with typed refusals elsewhere; platform-contracts tenancy per tool-blender precedent, R20; all pre-registered managed modules) |
| engine-unity | @playliquid/engine-unity | Tools | build-contracts, engine-adapter-contract, platform-contracts, target-profiles, tool-fabric, tool-fabric-runtime (PL-023; family row per module.ts; binding declares web/windows/macos/linux/android/ios per the delivery report — WebGL + standalone desktop + first-class mobile build targets; platform-contracts tenancy per tool-blender precedent, R20) |
| engine-godot | @playliquid/engine-godot | Tools | build-contracts, engine-adapter-contract, platform-contracts, target-profiles, tool-fabric, tool-fabric-runtime (PL-024; family row per module.ts; binding declares web/windows/macos/linux per the delivery report — Godot's HTML5 export + desktop trio; platform-contracts tenancy per tool-blender precedent, R20) |
| lab-organization | @playliquid/lab-organization | Lab | lab-contracts, avatar-runtime, lab-simulation, game-contracts, platform-contracts, package-system (PL-029; per module.ts — the three WO deps plus three deliberate direct declarations with lab-simulation/avatar-runtime precedent: frozen id/ref vocabulary, tenant isolation, canonical JSON authority; ranking/selection policy deliberately deferred to lab-learning PL-030) |
| lab-learning | @playliquid/lab-learning | Lab | lab-contracts, lab-simulation, lab-organization, game-contracts, platform-contracts, package-system (PL-030; per module.ts — the learning layer over the Lab loop: consumes PL-028 evaluation/calibration outputs and PL-029 search artifacts; three deliberate direct declarations per the delivery report with lab-simulation/lab-organization precedent; epistemic E11 disjointness structural) |
| target-builds | @playliquid/target-builds | Build | build-contracts, build-orchestrator, engine-godot, engine-playcanvas, engine-unity, engine-unreal, game-ir, package-system, runtime-contracts, target-profiles (PL-036; per module.ts — requires mirrors the package manifest's workspace deps exactly: the orchestrator drives per-target staged builds, the four adapters' bindings adjudicate resolution, build-contracts/target-profiles are the taxonomy authorities, package-system the digest/seal authority, game-ir the canonical value form, runtime-contracts the command vocabulary seam) |
| runtime-spark | @playliquid/runtime-spark | Runtime | runtime-core, runtime-contracts, game-ir, game-contracts, platform-contracts, package-system (PL-035; per module.ts — thin fast-start shell over the runtime-core kernel; the frozen SparkTargetProfile is the planning authority; platform-contracts tenancy per house precedent, R20) |
| spark | @playliquid/spark | Build | build-contracts, build-orchestrator, game-contracts, game-ir, package-system, runtime-contracts, runtime-spark, target-profiles (PL-035; per module.ts — the spark-target build surface: composes build-contracts inputs with runtime-spark's pure planning digests over the same game-ir content and drives the real build-orchestrator staged pipeline) |

## Design intent (work orders not yet merged)

| Module | Owner | Main dependency |
|---|---|---|

Rules:
- managed modules expose only public contracts;
- domain is pure;
- app orchestrates through ports;
- adapters own IO/tool/engine details;
- UI never imports implementation modules.
