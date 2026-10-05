# PlayLiquid GameOS — AI Continuation Contract

This file lets a fresh LLM Architect / Tech Lead continue without prior chat.

Repository: payswapdotorg/PlayLiquid
Product: PlayLiquid GameOS
Base: ZCode 3.14.3

## Recovery order

1. AGENTS.md
2. README.md
3. spec/PROJECT-STATE.md
4. spec/architecture.md
5. spec/architecture-lock.md
6. spec/requirements.md
7. spec/dependency-graph.md
8. spec/module-dependency-matrix.md
9. spec/work-items.md
10. spec/worker-contract.md
11. docs/handoff/FINAL-TECH-LEAD-HANDOFF.md
12. docs/handoff/EXECUTION-PLAN.md
13. docs/research/ARCHITECTURE-RESEARCH.md
14. exact Work Order
15. live GitHub branch/PR/CI state

## Evidence precedence

Actual source > tests > migrations/schema > runtime evidence > browser evidence > deployment/build evidence > exact Git SHAs > program state > docs summaries > agent reports > chat.

## Authority

ZCode remains the authority for its existing AI workspace, session, model/provider, client/server, desktop/web and remote-host infrastructure.

PlayLiquid owns GameIR, package/game/world/avatar semantics, platform game services, runtime/simulation/replay contracts, Tool Fabric, build targets, provenance/licensing policy, and Game Engineering Lab semantics.

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
