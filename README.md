# PlayLiquid GameOS

**PlayLiquid GameOS** is a Git-native, AI-native operating system for building, maintaining, testing, collaborating on, publishing, discovering and running executable worlds.

The repository started from **ZCode 3.14.3**. ZCode remains the underlying AI workspace, task/agent runtime, desktop/web/CLI foundation, model/provider infrastructure and tool environment. PlayLiquid adds world/package/Git lifecycle, runtime, platform services, Tool Fabric and discovery/play experiences on top.

## Product direction and implementation handoff

The repository is the source of truth; implementation must not depend on prior chats.

- [Product Experience Specification](docs/product/PRODUCT-EXPERIENCE-SPEC.md) — canonical product and UX requirements.
- [Figma Implementation Contract](docs/product/FIGMA-IMPLEMENTATION-CONTRACT.md) — authoritative Figma frames and exact screen rules.
- [Final Product Implementation Handoff](docs/handoff/FINAL-PRODUCT-IMPLEMENTATION-HANDOFF.md) — product implementation brief.
- [Final Tech Lead Handoff](docs/handoff/FINAL-IMPLEMENTATION-HANDOFF.md) — complete, self-contained execution plan and definition of done.
- [Product Experience Work Orders](spec/product-experience/WORK-ORDERS.md) — phases, ownership and acceptance.
- [Cross-Platform Distribution Contract](docs/release/CROSS-PLATFORM-DISTRIBUTION.md) — installable Linux/Windows build requirements.
- [Figma Design File](https://www.figma.com/design/LWlycZ5B3vCrUZ0a4pnu5u) — visual source.

## Download and install

You do **not** need to clone or build this repository to use a published desktop app.

### Current published builds

The latest published release is **Linux x64 only**. Windows installer publication is a required implementation task and must not be assumed available yet.

[GitHub Releases](https://github.com/payswapdotorg/PlayLiquid/releases/latest)

| Asset | Use |
|---|---|
| `PlayLiquid-GameOS-<version>-linux-amd64.deb` | Debian/Ubuntu install package (recommended on Ubuntu 24.04) |
| `PlayLiquid-GameOS-<version>-linux-x86_64.AppImage` | Portable Linux application |
| `SHA256SUMS` | Checksums for published artifacts |

Latest Linux release at the time of this update:
- [Release page](https://github.com/payswapdotorg/PlayLiquid/releases/tag/playliquid-gameos-v3.15.0)
- [.deb installer](https://github.com/payswapdotorg/PlayLiquid/releases/download/playliquid-gameos-v3.15.0/PlayLiquid-GameOS-3.15.0-linux-amd64.deb)
- [AppImage](https://github.com/payswapdotorg/PlayLiquid/releases/download/playliquid-gameos-v3.15.0/PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage)
- [SHA256SUMS](https://github.com/payswapdotorg/PlayLiquid/releases/download/playliquid-gameos-v3.15.0/SHA256SUMS)

### Install on Ubuntu/Linux

Recommended .deb installation:

```bash
wget https://github.com/payswapdotorg/PlayLiquid/releases/download/playliquid-gameos-v3.15.0/PlayLiquid-GameOS-3.15.0-linux-amd64.deb
wget https://github.com/payswapdotorg/PlayLiquid/releases/download/playliquid-gameos-v3.15.0/SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
sudo apt-get install -y ./PlayLiquid-GameOS-3.15.0-linux-amd64.deb
playliquid-gameos
```

AppImage:

```bash
wget https://github.com/payswapdotorg/PlayLiquid/releases/download/playliquid-gameos-v3.15.0/PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage
chmod +x PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage
./PlayLiquid-GameOS-3.15.0-linux-x86_64.AppImage
```

On stock Ubuntu 24.04, .deb is recommended because the package registers the AppArmor profile/sandbox fallback. AppImage may require the documented namespace workaround on systems that restrict unprivileged user namespaces. Do not change system security settings by default.

### Windows

A Windows installer is **not yet published** in the current release. The release contract requires an installable Windows x64 build, a native Windows launch smoke test, checksum and immutable SHA provenance. Do not tell users that Windows is supported for installation until a verified Windows asset is attached to a release.

### Inspect builds from any commit

The repository now defines `.github/workflows/playliquid-inspection-builds.yml` to build Linux and Windows x64 installable artifacts on each `main` push and on exact-SHA/tag manual dispatch. Each run uploads checksums and a build manifest. This workflow is newly added on the handoff branch and is not yet proven until GitHub Actions completes successful native builds. See [Cross-Platform Distribution Contract](docs/release/CROSS-PLATFORM-DISTRIBUTION.md).

## Repository source of truth and fresh-agent recovery order

A fresh Tech Lead/agent must read:

1. `AGENTS.md`
2. `AI_CONTINUATION.md`
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
16. `docs/handoff/FINAL-TECH-LEAD-HANDOFF.md`
17. `docs/handoff/EXECUTION-PLAN.md`
18. exact active Work Order and live GitHub branch/PR/CI state.

Actual source, tests, runtime behavior, browser evidence, package evidence and exact SHAs outrank docs summaries or agent reports.

## Product thesis

> **ZCode + Git-native world projects + package ecosystem + game platform + engine/tool orchestration + Game Engineering Lab.**

The stable foundation is:

`GameIR + Package Graph + Capability ABI + Git lifecycle`.

A World is the umbrella semantic/project model and is expressed as a game, Spark experience, interactive experience, simulation/training environment, real-world digital twin or future profile. A Spark remains a fast 9:16 mobile-first delivery/runtime target profile, not a separate root content model.

A World Project is a Git repository. Reusable worlds, regions, assets, avatars, systems, skills, tools and target definitions are independently versioned packages. Developers should be able to create and review native PlayLiquid changes without using GitHub; connected Git remotes are optional.

## Core concepts

### World

A versioned, addressable semantic world definition plus mutable runtime state. Large worlds are region/zone/chunk partitionable and progressively loaded as players explore. A world may have several delivery/experience profiles.

### Package

An independently versioned, content-addressed reusable unit with dependencies, capabilities, permissions, license, provenance, compatibility and lineage. Large binary artifacts are stored through CAS/object storage, not placed wholesale in ordinary Git history.

### Avatar

`Avatar = Body + Intelligence`. The body, sensors, actuators, memory, skills and cognitive substrate can be versioned independently and composed into multiple worlds. World policies constrain capabilities via the Capability Broker.

### Spark

A fast 9:16 delivery/runtime profile designed for minimal critical boot, aggressive caching, progressive streaming and near-instant first interaction. Playing a Spark stays within the vertical Sparks feed.

### Lab

The Game Engineering Lab learns which organizations, tools, capabilities, workflows and human interventions produce the best results for a particular world/task/phase/constraints.

### Arena

Arena is an external human-capability provider. It is not a second PlayLiquid workflow, world, package registry or experiment authority.

## Platform capabilities supplied once

Games declare events/policies; they do not reimplement platform infrastructure for:
- leaderboards and tournaments;
- multiplayer, matchmaking and presence;
- replay and stream VOD;
- rewards and Liquid spending/economy;
- achievements and cloud save;
- channel, social, follows/subscriptions and chat;
- analytics and moderation;
- competitive integrity/bot detection.

## Tool and engine strategy

PlayLiquid is the semantic/control interface, not a universal replacement for mature engines.

Tool Fabric integrates Unreal, Unity, Godot, Blender, PlayCanvas, generic CLI/process tools, filesystem/Git tooling and MCP transports behind provider-neutral contracts. Native engine projects remain native projects. Prefer reuse and orchestration of mature software over rebuilding editors.

## Build targets

The target system is designed for web, Spark, desktop, mobile, dedicated server, XR and console workflows. Console capability is gated on authorized vendor SDK/toolchains and actual verification. Deployment targets include Vercel, Cloudflare and other provider adapters the user chooses and that are actually supported.

## Development

The inherited ZCode toolchain remains authoritative:

```bash
pnpm bootstrap
pnpm typecheck
pnpm lint
pnpm architecture:check --changed
pnpm architecture:report
```

PlayLiquid program checks:

```bash
pnpm program:check
pnpm program:frontier
```

A previously completed architecture/program work order does not prove a new UI or external integration is production-ready. Each new feature requires a Work Order with source, tests, runtime and applicable browser/deployment evidence.

## Architecture overview

```text
ZCode foundation (preserved)
  ├── Existing New Task / Settings / Model Providers / Automations / Plugins
  ├── Existing Agent runtime / Browser / Terminal / tool services
  └── PlayLiquid product experience
        ├── World Projects / Git lifecycle
        ├── GameIR / Package Graph / Capability Broker
        ├── Interactive Runtime / Simulation / Replay
        ├── Platform Services (social, multiplayer, live, economy)
        ├── Tool + Engine Fabric
        ├── Build / Deployment / Streaming
        └── Discovery / Home / Play / Sparks / Channels
```

See `spec/architecture.md` and `spec/architecture-lock.md` for the frozen technical authorities.

## UI Plugins

See [UI_PLUGIN.md](UI_PLUGIN.md) for the UI Plugin API, plugin lifecycle and debugging. Plugin PRs must declare whether they include a UI Plugin and identify it.
