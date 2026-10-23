# PlayLiquid GameOS

**PlayLiquid GameOS** is a Git-native, AI-native operating system for building, maintaining, testing, collaborating on, and running executable worlds.

The repository started from **ZCode 3.14.3**. ZCode remains the underlying AI workspace, agent runtime, desktop/web/CLI foundation, and provider/model infrastructure. PlayLiquid adds the canonical GameOS semantic kernel and lifecycle on top of it.

## Download PlayLiquid GameOS for Ubuntu

You do **not** need to clone or build this repository to use the desktop app.
Ready-to-run Linux x64 packages are published on the
[GitHub Releases](https://github.com/payswapdotorg/PlayLiquid/releases/latest) page:

| asset | what it is |
| --- | --- |
| `PlayLiquid-GameOS-<version>-linux-amd64.deb` | Debian/Ubuntu package (**recommended on Ubuntu 24.04**) |
| `PlayLiquid-GameOS-<version>-linux-x86_64.AppImage` | single-file portable app, no installation |
| `SHA256SUMS` | checksums for the above assets |

Direct links always point at the **latest** release (stay version-agnostic):

- Latest release page: <https://github.com/payswapdotorg/PlayLiquid/releases/latest>
- `.deb`: <https://github.com/payswapdotorg/PlayLiquid/releases/latest/download/PlayLiquid-GameOS-3.15.0-linux-amd64.deb>
- AppImage: <https://github.com/payswapdotorg/PlayLiquid/releases/latest/download/PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage>
- `SHA256SUMS`: <https://github.com/payswapdotorg/PlayLiquid/releases/latest/download/SHA256SUMS>

*(Per-version assets use the same names with that release's version; find them
on the release page if you need a specific one.)*

### Requirements

- Linux x64 (built and smoke-tested on Ubuntu 24.04; also runs on Debian and
  other distributions with unprivileged user namespaces)
- Common desktop libraries already present on stock Ubuntu:
  `libgtk-3-0`, `libnotify4`, `libnss3`, `libxss1`, `libxtst6`, `xdg-utils`,
  `libatspi2.0-0`, `libuuid1`, `libsecret-1-0`

### Install (Ubuntu, recommended: the .deb)

```bash
# 1. download (or use the links above)
wget https://github.com/payswapdotorg/PlayLiquid/releases/latest/download/PlayLiquid-GameOS-3.15.0-linux-amd64.deb

# 2. verify the checksum (recommended)
wget https://github.com/payswapdotorg/PlayLiquid/releases/latest/download/SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS

# 3. install and launch
sudo apt-get install -y ./PlayLiquid-GameOS-3.15.0-linux-amd64.deb
playliquid-gameos
```

The `.deb` is recommended on Ubuntu 24.04: its install step registers the
app's AppArmor profile and sandbox fallback that stock 24.04 requires.

### Run the AppImage (no installation)

```bash
wget https://github.com/payswapdotorg/PlayLiquid/releases/latest/download/PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage
chmod +x PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage
./PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage
```

On Ubuntu 24.04's default namespace restriction the AppImage needs the
one-time documented workaround
(`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`) — or simply
prefer the `.deb` above. We do **not** recommend changing system security
settings as a default path; the `.deb` avoids it entirely.

### Troubleshooting

- **AppImage fails to start on Ubuntu 24.04** — use the `.deb` (see above), or
  apply the one-time sysctl workaround documented in the release notes.
- **Missing libraries** — install the requirements list above
  (`sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0`).
- **Checksum mismatch** — do not run the file; re-download from the release
  page and verify against `SHA256SUMS`.
- **Where are release notes / source / license?** — every release page carries
  the notes, the exact source commit SHA, and build evidence; the source is
  this repository (`Apache-2.0`, see `LICENSE`).

### Updates

PlayLiquid GameOS does not auto-update: the product's own update channel is
deliberately disabled (the inherited ZCode feed could replace PlayLiquid with
a ZCode build). Download a new release from the
[releases page](https://github.com/payswapdotorg/PlayLiquid/releases/latest)
to update; a PlayLiquid-owned verified feed may arrive later.


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

## UI Plugins

### UI Plugin development

See the [UI Plugin guide](UI_PLUGIN.en.md) for the Excalidraw workflow, supported APIs, plugin installation and updates, and host debugging.

**Plugin PRs in `zcode-plugins` must declare whether they affect a UI Plugin and list the plugin names in the PR template.** See the [required plugin-type declaration](UI_PLUGIN.en.md#declare-the-plugin-type-in-pull-requests).
