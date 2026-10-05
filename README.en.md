# PlayLiquid GameOS

**PlayLiquid GameOS** is a Git-native, AI-native operating system for building, maintaining, testing, collaborating on, and running executable worlds.

The repository started from **ZCode 3.14.3**. ZCode remains the underlying AI workspace, agent runtime, desktop/web/CLI foundation, and provider/model infrastructure. PlayLiquid adds the canonical GameOS semantic kernel and lifecycle on top of it.

## Repository source of truth

A fresh Tech Lead must read, in order:

1. `AGENTS.md`
2. `AI_CONTINUATION.md`
3. `spec/PROJECT-STATE.md`
4. `spec/architecture.md`
5. `spec/architecture-lock.md`
6. `spec/requirements.md`
7. `spec/dependency-graph.md`
8. `spec/module-dependency-matrix.md`
9. `spec/work-items.md`
10. `spec/worker-contract.md`
11. `docs/handoff/FINAL-TECH-LEAD-HANDOFF.md`
12. `docs/handoff/EXECUTION-PLAN.md`
13. the exact Work Order
14. live GitHub branch/PR/CI state

Actual source, tests, runtime behavior, Git history, and deployment evidence outrank summaries or chat.

## Product thesis

> **GitHub + ZCode + game platform + engine/tool orchestration + autonomous Game Engineering Lab.**

The stable foundation is:

`GameIR + Package Graph + Capability ABI + Git lifecycle`.

A game is a Git repository. A world, asset, avatar, system, skill, tool, simulation, test, evaluation, and target build definition are all packages. Games can be public/private and open/closed source, forked where rights permit, and evolved through normal repository lifecycle primitives.

## Core concepts

### Game

`Game = versioned composition of packages executed by a runtime`.

### World

A versioned, addressable semantic world definition plus mutable runtime state. Large worlds are region/zone/chunk partitionable.

### Asset

A independently versioned package with provenance, license, content digest and target/runtime compatibility.

### Avatar

`Avatar = Body + Intelligence`.

The body, sensors, actuators, memory, skills and cognitive substrate are separately versioned where appropriate. Games restrict avatar capabilities through the platform Capability Broker.

### Spark

A Spark is a **delivery/runtime target profile**, not a separate content model: vertical 9:16, mobile-first, aggressively cached, minimally booting, progressively streamed, and optimized for near-instant first interaction.

### Lab

The Game Engineering Lab learns which organizations, tools, capabilities, workflows and human interventions produce the best results for the current game/task/phase/constraints. It must improve from real project evidence over time.

### Arena

Arena is an external human-capability provider. PlayLiquid creates a capability gap/escalation request and consumes the validated result through a provider-neutral integration. Arena is not a second PlayLiquid workflow, world, package registry, or experiment authority.

## Platform capabilities supplied once

Games declare events/policies; they do not reimplement platform infrastructure for:

- leaderboards;
- multiplayer/matchmaking/presence;
- replay;
- rewards/play-to-earn;
- achievements;
- social;
- moderation;
- cloud save;
- analytics;
- tournament primitives;
- competitive integrity / bot detection.

## Tool and engine strategy

PlayLiquid is the main semantic/control interface, not a universal replacement for mature engines.

The Tool Fabric integrates Unreal, Unity, Godot, Blender, PlayCanvas, generic CLI/process tools, filesystem/Git tooling, and MCP transports behind provider-neutral contracts.

Native engine projects remain native projects. GameOS orchestrates them through adapters and builds target-specific artifacts where the required SDK/toolchain is available.

## Build targets

The target system is designed for web, Spark, desktop, mobile, dedicated server, XR, and console workflows. Console builds are gated on the required vendor SDKs/toolchains; the platform must never claim a console artifact that was not actually built and verified.

## Development

The inherited ZCode toolchain remains authoritative for base development:

```bash
pnpm bootstrap
pnpm typecheck
pnpm lint
pnpm architecture:check --changed
pnpm architecture:report
```

PlayLiquid program checks are:

```bash
pnpm program:check
pnpm program:frontier
```

The initial repository state is **architecture/bootstrap only**. No PlayLiquid GameOS feature is considered implemented until a Work Order proves it with source, tests, runtime, and applicable browser/deployment evidence.

## Architecture overview

```text
ZCode
  └── PlayLiquid GameOS
        ├── GameIR
        ├── Package Graph
        ├── Capability Broker
        ├── Runtime / Simulation / Replay
        ├── Platform Services
        ├── Tool + Engine Fabric
        ├── Build / Target Orchestrator
        └── Game Engineering Lab
               └── Arena capability escalation
```

See `spec/architecture.md` for the canonical architecture and `spec/architecture-lock.md` for non-negotiable authority boundaries.

## Research basis

Architecture decisions are recorded with research and implementation references in `docs/research/ARCHITECTURE-RESEARCH.md`, including generative agents, lifelong embodied agents, game balancing/bot-detection work, OpenUSD/glTF composition and delivery, and current engine packaging constraints.
