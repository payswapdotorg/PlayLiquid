# PlayLiquid GameOS — AI Continuation Contract

This file lets a fresh LLM Architect / Tech Lead continue without prior chat. The repository is the complete durable source of truth.

Repository: payswapdotorg/PlayLiquid  
Product: PlayLiquid GameOS  
Base: ZCode 3.14.3 fork (check Git history for the exact pinned fork baseline; do not silently upgrade upstream)

## Recovery order

1. `AGENTS.md`
2. `README.md`
3. `spec/PROJECT-STATE.md`
4. `spec/architecture.md`
5. `spec/architecture-lock.md`
6. `spec/requirements.md`
7. `docs/product/PRODUCT-EXPERIENCE-SPEC.md`
8. `docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md`
9. `docs/handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md`
10. `docs/handoff/FINAL-IMPLEMENTATION-HANDOFF.md` (complete product implementation handoff)
11. `spec/product-experience/WORK-ORDERS.md`
12. `docs/release/CROSS-PLATFORM-DISTRIBUTION.md`
13. `spec/dependency-graph.md`
14. `spec/module-dependency-matrix.md`
15. `spec/work-items.md`
16. `spec/worker-contract.md`
17. `docs/handoff/FINAL-TECH-LEAD-HANDOFF.md` (original architecture/program handoff)
18. `docs/handoff/EXECUTION-PLAN.md`
19. `docs/research/ARCHITECTURE-RESEARCH.md`
20. exact active Work Order and target module docs/tests
21. live GitHub main/branch/PR/CI/release state

## Evidence precedence

Actual source > tests > migrations/schema > runtime evidence > browser evidence > deployment/build evidence > exact Git SHAs > program state > docs summaries > agent reports > chat.

## Current product direction (binding)

The current product experience is fully defined in `docs/product/PRODUCT-EXPERIENCE-SPEC.md` and the Figma contract. Summary:
- preserve ZCode's existing application, New Task runtime, complete Settings/Model Provider system, Search, Automations, Plugin Marketplace, Groups/Projects, Browser and Terminal;
- redesign New Task in the PlayLiquid theme, with Select project dropdown above the prompt and Browser/Terminal toggles at top-right;
- all development is task/project centered; no separate Game Studio dashboard is the primary developer journey;
- everything reusable is a package;
- a World may be a game, Spark experience, interactive experience, simulation/training environment, real-world twin or future world profile;
- Spark remains a target/delivery profile, not a separate root content model;
- every World Project is Git-native and has tasks, branches, commits, semantic pull requests, review, merge, packages and deployment inside PlayLiquid;
- GitHub is an optional remote, not a required user interface;
- follow Figma exactly;
- reuse WebFlix component code only after rights/licensing verification; otherwise use it as an interaction guide;
- ship installable inspection builds for Linux and Windows with exact SHA/checksum evidence.

The new post-program workstream `spec/product-experience/WORK-ORDERS.md` supersedes the former Game-Studio/Lab/Community-primary UX direction for future UI decisions. Historical records stay immutable.

## Authority

ZCode remains the authority for its existing AI workspace, session, model/provider, task/agent runtime, client/server, desktop/web, remote-host and tool infrastructure.

PlayLiquid owns GameIR, package/game/world/avatar semantics, platform game services, runtime/simulation/replay contracts, Tool Fabric, build targets, provenance/licensing policy and Game Engineering Lab semantics.

Arena remains an external human capability provider.

## Hard constraints

- Maximum 3 concurrent workers.
- One Work Order = one branch = one PR = one frozen write surface.
- Workers never merge.
- TL owns root manifests, lockfiles, central registrations, program state and final merge decisions.
- Concurrent surfaces must be pairwise-disjoint.
- No second workflow engine.
- No second AI routing authority.
- No engine-specific types in GameOS semantic contracts.
- No mock presented as real production integration.
- No silent rights bypass.
- No client-authoritative competitive outcomes.
- No historical evidence rewriting.
- No fake engagement or anti-abuse evasion.
- Linux and Windows packaging must be native-runner tested; do not claim Windows release is available until artifacts are published and verified.
- Never let the inherited ZCode update feed update PlayLiquid.

## Current verified release state at 2026-10-31

The latest repository main observed during preparation is `78f2011595b2575c6eaee486a329bcdb4fae58bd`. The latest published desktop release observed is `playliquid-gameos-v3.15.0`, Linux x64 only (.deb + AppImage). The existing `.github/workflows/release-desktop.yml` builds Linux only. A Windows-aware bundler/config exists, but no Windows artifact is published by that workflow. See `docs/release/CROSS-PLATFORM-DISTRIBUTION.md`.

## Continue protocol

- Read current main and all active PRs; do not assume handoff branch has been merged.
- Confirm exact Figma frames are completed before implementing affected screens.
- Run the baseline gates and preserve ZCode behavior.
- Dispatch at most three pairwise-disjoint work orders.
- Keep repository docs, source, tests, screenshots, build artifacts and exact SHAs current.
- Do not rely on prior chats or ask the operator to reproduce information already stored here.
