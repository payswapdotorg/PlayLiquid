# PlayLiquid GameOS Work Orders

Program: PLGOS-1

Each Work Order = one branch = one PR = one frozen write surface = one accountable worker.

## Foundation

PL-001 GameIR contracts
Surface: packages/game-contracts, packages/game-ir
Depends: none

PL-002 Package contract
Surface: packages/package-system, spec/package-contract.md
Depends: none

PL-003 Runtime/Experience Protocol
Surface: packages/runtime-contracts
Depends: none

PL-004 Platform capability contracts
Surface: packages/platform-contracts
Depends: none

PL-005 Tool Fabric contracts
Surface: packages/tool-fabric, packages/engine-adapter-contract
Depends: none

PL-006 Lab contracts
Surface: packages/lab-contracts
Depends: PL-001

PL-007 Arena integration contract
Surface: packages/arena-integration
Depends: PL-006

PL-008 Build/target contracts
Surface: packages/build-contracts, packages/target-profiles
Depends: PL-003, PL-005

PL-009 Integrity/economy/replay contract refinement
Surface: packages/platform-contracts
Depends: PL-004

PL-010 Managed-module governance promotion
Surface: architecture-policy.yaml, spec/module-dependency-matrix.md
Depends: PL-001..PL-009
Owner: TL

## Foundations

PL-011 Package registry and CAS
Surface: packages/package-registry, packages/artifact-store
Depends: PL-002

PL-012 Git lineage/fork/overlay
Surface: packages/git-lineage
Depends: PL-001, PL-002

PL-013 Interactive runtime
Surface: packages/runtime-core
Depends: PL-001, PL-003

PL-014 Simulation and replay
Surface: packages/simulation, packages/replay
Depends: PL-003

PL-015 Identity/social/leaderboard/achievements
Surface: packages/platform-identity, packages/platform-social, packages/platform-leaderboard, packages/platform-achievements
Depends: PL-004

PL-016 Multiplayer authority
Surface: packages/platform-multiplayer
Depends: PL-003, PL-004

PL-017 Rewards/economy
Surface: packages/platform-economy
Depends: PL-004, PL-009

PL-018 Competitive integrity
Surface: packages/platform-integrity
Depends: PL-009, PL-014

PL-019 Tool Fabric runtime
Surface: packages/tool-fabric-runtime
Depends: PL-005

PL-020 Build orchestrator
Surface: packages/build-orchestrator
Depends: PL-008, PL-011, PL-019

## Engine/tool integrations

PL-021 PlayCanvas adapter
Surface: packages/engine-playcanvas
Depends: PL-019, PL-020

PL-022 Unreal adapter
Surface: packages/engine-unreal
Depends: PL-019, PL-020

PL-023 Unity adapter
Surface: packages/engine-unity
Depends: PL-019, PL-020

PL-024 Godot adapter
Surface: packages/engine-godot
Depends: PL-019, PL-020

PL-025 Blender adapter
Surface: packages/tool-blender
Depends: PL-019

## Avatars and Lab

PL-026 Avatar runtime + Capability Broker
Surface: packages/avatar-runtime, packages/capability-broker
Depends: PL-001, PL-003

PL-027 Sensory runtime
Surface: packages/sensory-runtime
Depends: PL-026

PL-028 Lab simulation/evaluation
Surface: packages/lab-simulation
Depends: PL-006, PL-014, PL-026

PL-029 Organization compiler/search
Surface: packages/lab-organization
Depends: PL-006, PL-026, PL-028

PL-030 Lab learning/calibration
Surface: packages/lab-learning
Depends: PL-028, PL-029

PL-031 Arena runtime integration
Surface: packages/arena-integration-runtime
Depends: PL-007, PL-030

PL-032 Community contribution
Surface: packages/community
Depends: PL-012, PL-004

## Product/runtime targets

PL-033 Game Studio foundation
Surface: packages/game-ui, packages/web/gameos
Depends: PL-011, PL-013, PL-019, PL-026

PL-034 Lab/community UX
Surface: packages/web/gameos-lab, packages/web/gameos-community
Depends: PL-028, PL-030, PL-032

PL-035 Spark runtime/build
Surface: packages/runtime-spark, packages/spark
Depends: PL-013, PL-020

PL-036 Multi-target builds
Surface: packages/target-builds
Depends: PL-020, PL-021, PL-022, PL-023, PL-024

## Proof and hardening

PL-037 Native GameOS reference game
Surface: examples/native-game
Depends: PL-011, PL-013, PL-015, PL-017, PL-018, PL-021, PL-035

PL-038 Engine-native reference workflow
Surface: examples/engine-integration
Depends: PL-020, PL-022, PL-023, PL-024, PL-025

PL-039 Large-world/package-graph reference
Surface: examples/large-world
Depends: PL-011, PL-013, PL-014, PL-020

PL-040 Lab/Arena end-to-end journey
Surface: examples/lab-journey, qa/e2e-lab
Depends: PL-028, PL-029, PL-030, PL-031, PL-032

PL-041 Security/rights hardening
Surface: packages/security-gameos, qa/security
Depends: PL-011, PL-026, PL-017, PL-018, PL-031

PL-042 Performance/scale
Surface: qa/performance, packages/runtime-core/perf, packages/build-orchestrator/perf
Depends: PL-014, PL-020, PL-021, PL-039

PL-043 Browser journeys
Surface: qa/browser, docs/journeys
Depends: PL-033, PL-034, PL-035, PL-037

PL-044 Deployment/operations
Surface: services, deployment, docs/deployment
Depends: PL-033, PL-034, PL-036, PL-041, PL-043

PL-045 Final release audit
Surface: spec/PROJECT-STATE.md, docs/handoff, program/graph.json
Depends: PL-037, PL-038, PL-039, PL-040, PL-041, PL-042, PL-043, PL-044
Owner: TL
