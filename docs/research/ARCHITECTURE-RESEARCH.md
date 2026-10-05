# Architecture Research

This is a design evidence register.

## Agents and learning

Park et al., Generative Agents (2023): observation, memory, reflection and planning are explicit architectural components.
https://arxiv.org/abs/2304.03442

Wang et al., Voyager (2023): persistent executable skill library, automatic curriculum, iterative feedback and self-verification support lifelong embodied learning.
https://arxiv.org/abs/2305.16291

## World and asset composition

OpenUSD: layered composition and references support large modular scene assembly.
https://openusd.org/

Khronos glTF: efficient transmission/loading of 3D scenes and models with low runtime processing overhead.
https://www.khronos.org/gltf/

## Engines and builds

Unreal Engine 5.8 packaging documentation shows build/cook/package flows and broad desktop/mobile/XR/console target coverage, while console workflows require authorized target setup and toolchains.
https://dev.epicgames.com/documentation/unreal-engine/packaging-your-project
https://dev.epicgames.com/documentation/unreal-engine/consoles-development-in-unreal-engine

PlayCanvas currently provides WebGL2 + WebGPU, TypeScript/ES modules, tree-shaking and a lightweight browser runtime suitable as an early GameOS-native renderer.
https://playcanvas.com/products/engine

## Architecture implications

- GameIR must remain independent from specific engines.
- Tool/engine automation belongs behind adapters.
- Runtime delivery should separate source/authoring formats from optimized delivery formats.
- Console support must be capability/toolchain gated.
- Avatar intelligence should have persistent memory/skills and explicit runtime boundaries.
- Simulation/replay should be common infrastructure for human and AI evaluation.

Research does not prove perfect universal engine abstraction, perfect bot detection, or autonomous full-game creation. Those remain engineering hypotheses to validate through the Lab.
