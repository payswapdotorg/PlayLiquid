# PlayLiquid GameOS Agent Contract

## Repository authority

This repository is the unique durable source of truth for PlayLiquid GameOS architecture and implementation.

A fresh agent must read `AI_CONTINUATION.md` and the canonical files listed in `README.md` before touching code.

Actual Git history, source, tests, migrations, runtime behavior, browser/deployment evidence and exact SHAs outrank reports, summaries, screenshots and chat.

## Product direction authority

The current product UX and information architecture are defined by:
- `docs/product/PRODUCT-EXPERIENCE-SPEC.md`
- `docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md`
- `docs/handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md`
- `docs/handoff/FINAL-IMPLEMENTATION-HANDOFF.md` (authoritative complete TL execution handoff)
- `spec/product-experience/WORK-ORDERS.md`
- `docs/release/CROSS-PLATFORM-DISTRIBUTION.md`

These are repository-owned instructions, not optional chat context. The new workstream supersedes the old Game-Studio/Lab/Community-primary UX contract for future product UX decisions. It does not rewrite historical UX/program records or erase existing domain services.

**Current UX rules:**
- ZCode New Task is the starting experience; preserve its underlying task, model, provider, attachment, access and runtime features.
- Preserve ZCode Settings and the entire Model Provider implementation. Never create a second provider/settings authority.
- Preserve Search, Automations, Plugin Marketplace, Group/Project navigation, Browser and Terminal.
- New Task requires a visible Select project dropdown above the composer and Browser/Terminal toggles at the top-right of the task workspace header.
- Projects are the development workspace. Do not make a standalone Game Studio dashboard the primary development journey.
- A World is the umbrella model and can be a game, Spark experience, interactive experience, simulation/training world, digital twin or future extensible profile. Spark remains a delivery/runtime target profile under architecture lock #16.
- Everything reusable is a package. A World Project is Git-native. Native PlayLiquid project work must not require GitHub; connected Git providers are optional remotes.
- Use the approved Figma frames as the visual specification. Do not invent a competing interpretation.
- WebFlix is the interaction/visual reference; copy its code only after ownership/license authorization. Otherwise use it as a clean-room behavioral guide.
- Linux and Windows installable inspection builds must be available with checksums and exact source commit provenance. Current published workflow only proves Linux; see the release contract.

Before coding any UI Work Order, check that the relevant Figma frames are complete and pinned. See `docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md`.

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
2. `README.md`
3. `spec/PROJECT-STATE.md`
4. `spec/architecture.md`
5. `spec/architecture-lock.md`
6. `spec/requirements.md`
7. `docs/product/PRODUCT-EXPERIENCE-SPEC.md`
8. `docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md`
9. `docs/handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md`
10. `spec/product-experience/WORK-ORDERS.md`
11. `docs/release/CROSS-PLATFORM-DISTRIBUTION.md`
12. `spec/dependency-graph.md`
13. `spec/module-dependency-matrix.md`
14. `spec/work-items.md`
15. `spec/worker-contract.md`
16. exact Work Order
17. target module contract/spec and tests
18. live GitHub base SHA and PR state

For source changes, also run the inherited architecture-governance flow:
`pnpm architecture:check --changed` → `pnpm architecture:context <module-id>`.

## Non-negotiable architecture rules

- One authority per concern.
- One owner for every mutable state.
- One canonical command/event path for each behavior.
- GameIR is the semantic kernel.
- Package Graph is the composition/dependency authority.
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
- Spark is a target profile, not a separate content type.
- Large binary artifacts use content-addressed storage, not ordinary Git history.
- Provenance/licensing is a release/build gate.
- Console capability is SDK/toolchain gated and must be proven.
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
