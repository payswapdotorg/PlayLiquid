# PlayLiquid GameOS Agent Contract

## Repository authority

This repository is the unique durable source of truth for PlayLiquid GameOS architecture and implementation.

A fresh agent must read `AI_CONTINUATION.md` and the canonical files listed in `README.md` before touching code.

Actual Git history, source, tests, migrations, runtime behavior, browser/deployment evidence and exact SHAs outrank reports, summaries, screenshots and chat.

## Relationship to ZCode

This is a ZCode fork.

ZCode remains authoritative for:
- AI workspace/session/runtime infrastructure;
- model/provider routing;
- base desktop/web/CLI application infrastructure;
- existing RPC/client/server/provider abstractions;
- existing ZCode architecture-governance tooling.

PlayLiquid GameOS owns:
- GameIR;
- package/game/world/avatar semantics;
- game lifecycle;
- platform gameplay services;
- runtime/simulation/replay contracts;
- tool/engine integration contracts;
- target/build orchestration;
- Game Engineering Lab;
- PlayLiquid-specific provenance and capability policies.

Do not create a second ZCode model-routing, agent-session, remote-host, or generic workflow authority.

## Before implementing any Work Order

Read:
1. `AI_CONTINUATION.md`
2. `spec/PROJECT-STATE.md`
3. `spec/architecture.md`
4. `spec/architecture-lock.md`
5. `spec/requirements.md`
6. `spec/dependency-graph.md`
7. `spec/module-dependency-matrix.md`
8. `spec/work-items.md`
9. `spec/worker-contract.md`
10. exact Work Order
11. target module contract/spec and tests
12. live GitHub base SHA and PR state

For source changes, also run the inherited architecture-governance flow:
`pnpm architecture:check --changed` → `pnpm architecture:context <module-id>`.

## Non-negotiable architecture rules

- One authority per concern.
- One owner for every mutable state.
- One canonical command/event path for each behavior.
- GameIR is the semantic kernel.
- Package Graph is the dependency/composition authority.
- Capability Broker is the runtime permission authority for avatar/agent actions.
- GameOS platform services own reusable game-wide services.
- Deterministic simulation is the test/evaluation foundation where feasible.
- Replay is a first-class platform artifact.
- Interactive Runtime and Simulation Runtime share semantic contracts but are separate execution paths.
- AI proposes intents/patches; authoritative deterministic systems mutate state.
- AI model selection stays under ZCode/AI runtime.
- Arena is an external capability provider.
- Engine SDKs and DCC tools are adapters, not domain authorities.
- MCP is a transport/integration mechanism, not the semantic kernel.
- Spark is a target profile, not a content type.
- Large binary artifacts use content-addressed storage, not ordinary Git history.
- Provenance/licensing is a release/build gate.
- Console support is truthful and SDK-gated.
- User/community contribution never silently becomes a prerequisite for autonomous operation.
- Lab evidence never rewrites historical observations.
- Simulated/counterfactual results are never represented as historical fact.
- Competitive-integrity signals are evidence/confidence, not magical certainty.
- No fake engagement, anti-abuse evasion, impersonation, fabricated testimonials, or rights circumvention.

## Worker model

Maximum three concurrent workers.

Each Work Order is:
`one branch = one PR = one frozen write surface = one accountable worker`.

Workers never merge their own PRs.

Workers must not edit:
- root manifests;
- lockfiles;
- architecture locks;
- program state;
- central dependency graphs;
- central composition roots

unless their Work Order explicitly owns that surface.

Concurrent Work Orders must have pairwise-disjoint write surfaces.

The TL serializes shared/root composition and records merged SHAs.

## Testing

Behavior changes require tests.

UI changes require real browser evidence at:
- 390x844;
- 1280x800.

Game runtime changes should include deterministic/replay evidence where applicable.

Long-running simulation/build/training work must use the durable worker path, not synchronous web requests.

Never claim an artifact is production-ready merely because a mock or static UI exists.

## Verification standard

A Work Order can be marked green only when applicable evidence agrees across:
- source;
- tests;
- runtime;
- browser;
- deployment/build environment.

Any unavailable external SDK, hardware or platform service must be recorded as an explicit environment limitation rather than simulated away.

## Scope discipline

Do not redesign frozen architecture from inside an implementation Work Order.

When an implementation discovers a genuine architectural defect, record an Architecture Change Request and stop the affected downstream implementation rather than adding a parallel authority or hidden compatibility path.
