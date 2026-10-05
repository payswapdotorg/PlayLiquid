# PlayLiquid GameOS Worker Contract

Read AGENTS.md, AI_CONTINUATION.md and all canonical spec files before coding.

## Contract

- Exactly one Work Order per worker.
- Exactly one branch and PR.
- Frozen write surface.
- No merge.
- No architecture redesign.
- No hidden scope expansion.
- Tests first for behavior changes.
- Real runtime/browser evidence where applicable.

## Central TL-owned surfaces

Unless a Work Order explicitly says otherwise:
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml
- architecture-policy.yaml
- program/graph.json
- spec/PROJECT-STATE.md
- central application registration
- root CI composition

## Async/stateful work

Document:
- mutable state owner;
- command admission;
- event order;
- idempotency key;
- stale-result rule;
- replay/resume boundary;
- retry/cancellation semantics.

## Engines/tools

Use Tool Fabric. Do not place Unreal/Unity/Godot/Blender implementation types in GameOS domain contracts.

## Arena

Use provider-neutral Arena integration. Never import Arena internal domain/storage authority.

## Evidence

PR must include:
- base SHA;
- changed files;
- tests and exact commands;
- runtime evidence;
- browser evidence for UI;
- environment limitations;
- Work Order acceptance mapping.
