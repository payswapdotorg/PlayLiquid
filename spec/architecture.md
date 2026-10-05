# PlayLiquid GameOS Architecture

Version: 1.0
Status: CANONICAL / APPROVED

## Thesis

PlayLiquid GameOS is a Git-native, AI-native operating system for building, maintaining, testing, collaborating on and running executable worlds.

Stable foundation:
GameIR + Package Graph + Capability ABI + Git lifecycle.

ZCode remains the AI workspace/model/provider/runtime foundation. PlayLiquid adds the game/world/package/runtime/platform/Lab semantics without creating duplicate ZCode authorities.

## Game model

Game = versioned composition of packages + target profile + runtime policy.

Game contents are:
- World
- Assets
- Avatars

Avatar = Body + Intelligence.

Everything reusable is a package.

## GameIR

GameIR is the engine-independent semantic kernel.

It contains:
- repository identity;
- package graph;
- world topology and state schema;
- assets/references;
- avatar definitions;
- systems/mechanics;
- interactions;
- social/economic rules;
- sensory channels;
- platform declarations;
- runtime policies;
- target profiles;
- evaluation suites.

AI builders reason primarily over GameIR and package contracts, then produce semantic patches/PRs.

## Package Graph

Packages are immutable, versioned and content-addressable.

Each package records:
- kind;
- identity/version;
- content digest;
- dependencies;
- capabilities;
- permissions;
- license;
- provenance;
- runtime/engine compatibility;
- target compatibility;
- resource requirements;
- evaluation compatibility;
- lineage.

Large binary artifacts live in CAS/object storage and are referenced from Git manifests.

Game lockfiles pin exact versions/digests.

Overlay packages are supported for narrow changes without whole-package forks.

## Git lifecycle

Every game is a repository.

Supported:
- public/private;
- open/closed source;
- branch/commit/PR;
- issues/reviews;
- semantic diffs;
- releases;
- forks;
- overlays;
- lineage.

Semantic PRs can show:
- code;
- package;
- world;
- asset;
- avatar;
- capability;
- policy;
- license;
- simulation;
- replay;
- performance changes.

## World

Static definition and mutable runtime state are distinct.

Static:
topology, entities, systems, rules, package references.

Runtime:
positions, health, inventories, ownership, relationships, economy, events.

Spatial hierarchy:
World → Region → Zone → Chunk.

Chunks can be independently streamed/cached/built when the contract permits.

## Avatar

Body:
geometry, skeleton, animation, physics, appearance.

Intelligence:
cognitive substrate, memory, skills, planning, reflection, policy.

Sensors:
vision, audio, touch, smell, taste, proprioception, vestibular.

Actuators:
movement, manipulation, speech, gaze, sensory output.

Portable avatar packages may be imported into multiple games.

All actions pass through Capability Broker and game policy.

## Agent classes

Builder Agent:
repository/tool/build/simulation/PR authority.

Avatar Agent:
world perception/decision/action authority.

These are distinct trust domains.

Model selection remains under ZCode AI runtime.

## Capability Broker

Flow:
intent → capability broker → game policy → authoritative system → state mutation.

The broker enforces capability permissions, schemas, budgets, rate limits, auditability and side-effect boundaries.

## Runtime

Two implementations share Experience Protocol:

Interactive Runtime:
rendering, input, networking, live world.

Simulation Runtime:
headless, reproducible, resettable, snapshot-able, replayable, scalable.

Experience Protocol:
load, reset, observe, act, step, snapshot, restore, replay, terminate.

The current inherited simple canvas engine may be retained only as a bounded compatibility/prototype runtime; it is not the long-term universal engine.

## Spark

Spark is a target profile, not a second content model.

Properties:
- 9:16;
- mobile-first;
- minimal critical boot;
- aggressive caching;
- progressive streaming;
- first-interaction optimization.

## Platform services

GameOS owns reusable:
- identity;
- social;
- leaderboard;
- multiplayer;
- matchmaking;
- presence;
- replay;
- rewards;
- achievements;
- cloud save;
- analytics;
- moderation;
- tournaments;
- competitive integrity.

Games declare events/policies; they do not create duplicate platform authorities.

## Multiplayer

Authoritative server/runtime state determines competitive outcomes.

Client sends input/intent.
Server validates/simulates and emits state/events.

Rewards, inventory, damage and protected outcomes cannot be client-authoritative.

## Rewards

Games declare eligible semantic events/policies.

GameOS owns validation, integrity, entitlements and settlement.

## Competitive Integrity

The platform evaluates bot/automation/AI-assisted play using behavioral evidence such as trajectories, timing and outcome patterns.

Output is evidence/confidence/risk; enforcement is policy-driven.

Explicit AI-player modes must be supported.

The system never claims perfect detection.

## Tool Fabric

Provider-neutral operations include:
inspect project/scene/asset, modify/import/export, run editor action/script, build/cook/package/launch/profile/capture/test/replay/debug.

Adapters include:
Unreal, Unity, Godot, PlayCanvas, Blender, generic CLI/process, filesystem, Git and MCP transport.

MCP is not the semantic authority.

## Engine strategy

GameOS-native projects use GameIR directly.

Engine-native projects retain native engine envelopes.

The platform orchestrates mature tools rather than pretending to replace them.

## Build

Inputs:
GameIR digest + package lock + target profile + engine binding + toolchain/environment profile.

Outputs:
artifact + build manifest + provenance evidence + verification evidence.

Targets:
web, spark, windows, macos, linux, android, ios, steamdeck, xr, dedicated-server, console.

Console artifacts require authorized vendor SDK/toolchains and actual verification.

## Interchange

OpenUSD is an authoring/composition/interchange path for complex 3D content.

glTF/GLB is a major runtime/interchange delivery path.

Neither is the semantic kernel.

## Game Engineering Lab

The Lab learns development organizations and capability allocation.

Candidate dimensions:
- number of agents;
- roles;
- Agent Bodies;
- model assignments through ZCode;
- tools;
- capabilities;
- communication/delegation;
- memory topology;
- human participation;
- budget;
- scheduling;
- review/evaluation structure.

A single generalist agent is always a baseline.

The best organization may vary by game, phase, genre, engine, target, team, deadline, budget and task difficulty.

## Lab loop

Project evidence
→ diagnosis
→ hypothesis
→ organization search
→ simulation/evaluation
→ implementation candidate
→ PR
→ release
→ observed outcome
→ calibration
→ next search.

Historical observations remain immutable.

Counterfactuals and simulator output are explicitly labeled estimates.

## Capability gaps

Resolution:
existing organization → alternate organization → package/platform capability → user/community contribution → Arena → blocked.

Arena is external and optional for normal autonomy.

## Arena

PlayLiquid sends a typed provider-neutral escalation request.

Arena returns validated:
- results;
- evidence;
- capability/tool/skill/knowledge artifacts where explicitly authorized.

Arena cannot directly mutate PlayLiquid live state.

## Community

Users can contribute:
issues, replay-backed reports, code, packages, assets, skills, levels, dialogue, voice/performance, reviews, PRs and tests.

Contribution artifacts preserve provenance and normal Git lifecycle.

## Security

Third-party packages, AI-generated code, avatar brains and external tools are untrusted until qualified.

Least privilege, sandboxing and tenant isolation are mandatory.

## Scalability

Use a federated package graph, CAS artifacts, incremental builds, spatial world partitions and scalable headless simulation.

Goal: Linux-like ecosystem scale rather than a single monolithic game project.
