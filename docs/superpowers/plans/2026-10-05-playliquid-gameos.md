# PlayLiquid GameOS Implementation Plan

> For agentic workers: use the repository Work Orders and Worker Contract. Each Work Order is independently reviewed and merged by the Tech Lead.

**Goal:** Implement the complete PlayLiquid GameOS architecture from the frozen semantic kernel through runtime/platform services, engine/tool integration, Game Engineering Lab, Arena escalation, product UX, multi-target builds, and proof/hardening.

**Architecture:** Preserve ZCode as the AI workspace/model/provider foundation. Build PlayLiquid semantics behind GameIR, Package Graph, Capability Broker, Runtime/Experience Protocol and provider-neutral Tool Fabric; keep external engines and Arena behind adapters.

**Tech Stack:** Existing ZCode 3.14.3 workspace; TypeScript/Node 24; pnpm 10.33.2; existing React/Electron/web/CLI foundation; provider-neutral adapters; content-addressed artifacts; durable workers/queues; real engine SDKs/toolchains where available.

**Spec:** spec/architecture.md

## Global Constraints

- GameIR is the semantic kernel.
- Package Graph is the composition/dependency authority.
- Git is the project lifecycle authority.
- Capability Broker is the runtime authorization boundary.
- ZCode remains AI/model/provider authority.
- Arena remains an external human-capability provider.
- Everything reusable is a package.
- Spark is a target profile, not a second game model.
- Platform gameplay services are implemented once by GameOS.
- Interactive and simulation runtimes share semantic contracts but are distinct.
- AI produces typed intents/patches; authoritative systems own state mutation.
- Provider/engine SDKs stay behind adapters.
- Maximum 3 concurrent workers.
- One Work Order = one branch = one PR = one frozen write surface.
- Workers never merge.
- TL owns root manifests, lockfiles, central registrations and program state.
- Historical evidence is immutable.
- Console support is SDK/toolchain gated and must be proven.
- No fake engagement, rights circumvention, anti-abuse evasion or hidden production mocks.

## Review Focus

- Duplicate authority: tests must prove platform services are not reimplemented by game packages.
- Engine leakage: contracts must prove engine-specific types do not enter GameOS semantics.
- Replay integrity: replay tests must prove exact version/package/runtime lineage.
- Competitive integrity: negative tests must cover automation, tampering and explicitly permitted AI-play modes.
- Lab/Arena boundary: tests must prove Arena cannot directly mutate a live game and that learned artifacts enter through typed capability contracts.

---

## Program execution

The authoritative task decomposition is spec/work-items.md plus program/graph.json. The TL should execute the 45 Work Orders in dependency order while keeping up to three disjoint workers active.

### Task 1: Semantic contracts

Work Orders: PL-001..PL-009

Deliver:
- GameIR;
- Package Contract;
- Experience Protocol;
- Platform capability contracts;
- Tool Fabric;
- Lab contracts;
- Arena integration contract;
- Build/target contract;
- integrity/economy/replay refinements.

Verification:
- schema/contract tests;
- serialization round trips;
- invalid input tests;
- authority-boundary tests.

### Task 2: Package/Git/build foundations

Work Orders: PL-010..PL-020

Deliver:
- managed-module governance;
- package registry/CAS;
- Git lineage/fork/overlay;
- interactive runtime;
- simulation/replay;
- platform identity/social/leaderboard/achievements;
- multiplayer;
- rewards;
- integrity;
- Tool Fabric runtime;
- build orchestrator.

Verification:
- deterministic package resolution;
- lock verification;
- fork/overlay lineage;
- runtime protocol;
- replay reproduction;
- authoritative multiplayer/reward tests;
- tool execution;
- incremental build graph.

### Task 3: Engine/tool adapters

Work Orders: PL-021..PL-025

Deliver real adapters for:
- PlayCanvas;
- Unreal;
- Unity;
- Godot;
- Blender.

Verification:
- actual tool discovery;
- actual project inspection;
- actual supported operations;
- truthful unavailable-toolchain failure;
- no provider types in GameOS contracts.

### Task 4: Avatars and sensory runtime

Work Orders: PL-026..PL-027

Deliver:
- portable Avatar Body + Intelligence;
- possession;
- capability enforcement;
- sensory/actuator abstraction.

Verification:
- cross-game avatar reuse;
- capability allow/deny;
- unauthorized action rejection;
- unavailable-device degradation.

### Task 5: Game Engineering Lab

Work Orders: PL-028..PL-030

Deliver:
- headless Lab execution;
- simulation/evaluation;
- organization compiler/search;
- generalist baseline;
- learning/calibration;
- immutable historical evidence.

Verification:
- multi-topology comparison;
- deterministic seeds;
- uncertainty;
- OOD/regression checks;
- contextual organization changes;
- prediction-vs-observation calibration.

### Task 6: Arena and community capability acquisition

Work Orders: PL-031..PL-032

Deliver:
- Arena provider-neutral integration;
- explicit capability-gap flow;
- community contribution/Issue/PR artifacts.

Verification:
- isolated escalation;
- typed results;
- no live-world mutation by Arena;
- provenance of human/community contributions;
- autonomous zero-human path remains valid.

### Task 7: Product UX and Spark

Work Orders: PL-033..PL-035

Deliver:
- Game Studio;
- Lab/community UX;
- Spark runtime/build target.

Verification:
- real APIs;
- no raw JSON default;
- mobile 390x844;
- desktop 1280x800;
- Spark first-interaction path;
- no dead controls.

### Task 8: Multi-target build system

Work Order: PL-036

Deliver target profiles and build orchestration for:
web, Spark, desktop, mobile, dedicated server, XR and console capability gating.

Verification:
- actual available target artifacts;
- artifact provenance;
- SDK/toolchain detection;
- truthful console limitation states.

### Task 9: Reference proofs

Work Orders: PL-037..PL-040

Deliver:
- native GameOS reference game;
- engine-native workflow reference;
- large-world/package-graph reference;
- Lab/Arena end-to-end journey.

Verification must demonstrate the product thesis end-to-end, not only unit contracts.

### Task 10: Security, scale, browser and operations

Work Orders: PL-041..PL-044

Deliver:
- least-privilege/rights hardening;
- performance/scale baselines;
- browser journey suite;
- deployment and durable-worker operations.

Verification:
- security negatives;
- load tests;
- replay/AI-play integrity;
- browser evidence;
- health/readiness;
- durable worker behavior;
- deployment truth.

### Task 11: Final release audit

Work Order: PL-045

TL-only.

Deliver:
- exact merged SHA audit;
- program graph reconciliation;
- final state;
- evidence index;
- empty frontier.

Acceptance:
Every required reference scenario is reproducible and every claimed production capability has source + tests + runtime + applicable browser/deployment evidence.

## Execution rhythm

At every iteration:
1. read program frontier;
2. dispatch up to three disjoint Work Orders;
3. inspect actual PR diff and evidence;
4. merge only accepted work;
5. refresh main;
6. run program check/frontier;
7. dispatch the next frontier.

Do not wait for an entire conceptual wave when unrelated Work Orders are already ready.

## Completion

The implementation program is complete only when Work Orders PL-001 through PL-045 are merged with exact SHAs, the frontier is empty, the architecture check is clean, required browser/build/runtime proofs pass, and no prohibited architecture drift remains.
