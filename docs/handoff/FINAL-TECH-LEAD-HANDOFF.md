# Final Tech Lead Handoff — PlayLiquid GameOS

Repository: payswapdotorg/PlayLiquid

## Mission

Turn this ZCode 3.14.3 fork into PlayLiquid GameOS using the frozen repository architecture.

## First commands

pnpm program:check
pnpm program:frontier
pnpm architecture:report
git status --short
git log --oneline -12

Then read the recovery order in AI_CONTINUATION.md.

## Kernel

GameIR + Package Graph + Capability ABI + Git lifecycle.

ZCode remains the AI workspace/model/provider authority.
Arena is the external human capability provider.

## Team

Exactly 3 concurrent workers.

Keep all 3 busy whenever the frontier contains 3 pairwise-disjoint Work Orders.

Worker A should normally take a semantic/runtime/platform item.
Worker B should normally take tool/build/engine work.
Worker C should normally take Lab/avatar/product work.

Rotate workers as the frontier changes. Do not serialize unrelated work merely because it is conceptually in the same wave.

## TL-only responsibilities

- shared contracts;
- root manifests/lockfiles;
- architecture policy;
- program state;
- central registrations;
- merge;
- final integration;
- final verification.

## Required proof

- natural language → GameIR → packages → Spark;
- fork/overlay/provenance lifecycle;
- portable avatar with capability restriction;
- platform leaderboard/replay/multiplayer/reward/integrity;
- user contribution → issue/PR;
- Lab organization search and learning;
- capability gap → Arena → validated result;
- Unreal/Unity/Godot/PlayCanvas/Blender integration;
- web/mobile/desktop build;
- truthful console gating;
- deterministic replay/simulation;
- partitioned large-world/package graph;
- incremental build.

## GREEN rule

A claim is green only when source + tests + runtime + applicable browser/deployment evidence agree.

Agent reports do not establish completion.

## Final audit

All Work Orders merged with exact SHAs, program graph consistent, frontier empty, architecture checks clean, required tests and journeys green, and no prohibited duplicate authority.
