# PlayLiquid GameOS Dependency Graph

## Dependency direction

ZCode foundation
→ Game contracts
→ GameIR / Package / Capability / Runtime / Platform / Tool / Build / Lab contracts
→ implementations
→ adapters and integrations
→ product UI and examples.

## Core graph

game-contracts
→ game-ir
→ package-system
→ provenance
→ git-lineage
→ capability-broker
→ runtime-contracts
→ platform-contracts
→ tool-fabric
→ build-contracts
→ lab-contracts

game-ir
→ runtime-core
→ simulation
→ avatar-runtime
→ world-runtime

package-system
→ package-registry
→ artifact-store
→ git-lineage
→ build-orchestrator

runtime-contracts
→ runtime-core
→ simulation
→ replay

platform-contracts
→ identity/social/leaderboard
→ multiplayer
→ economy
→ integrity
→ replay

tool-fabric
→ Unreal/Unity/Godot/PlayCanvas/Blender adapters
→ build integrations

lab-contracts
→ lab-simulation
→ lab-organization
→ lab-learning
→ arena-integration

No dependency may point:
- from GameIR into a specific engine implementation;
- from domain into provider SDKs;
- from avatar brain directly into filesystem/network authority;
- from UI into implementation modules;
- from Lab directly into production publication;
- from Arena integration into Arena internal domain/storage.
