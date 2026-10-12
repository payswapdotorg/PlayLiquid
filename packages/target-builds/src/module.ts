/**
 * target-builds 模块清单（PL-036；PL-010 治理格式，当前为 worker 交付态，
 * 由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * requires 与包 manifest 的 workspace 依赖一致。多目标构建运行在
 * build-orchestrator（PL-020 —— 每目标一份分阶段构建文档）、四个引擎
 * 适配器（PL-021..PL-024 —— 类型化 engine binding 与兼容谓词）、
 * build-contracts + target-profiles（PL-008 —— 构建请求词汇与冻结目标
 * 分类法）、package-system（摘要/锁/封印权威）与 game-ir（请求参数的
 * 规范值形 —— 结构化值的唯一规范化权威）之上。对外只暴露 src/index.ts。
 */
export const target_buildsModule = {
  id: "target-builds",
  requires: [
    "build-contracts",
    "build-orchestrator",
    "engine-godot",
    "engine-playcanvas",
    "engine-unity",
    "engine-unreal",
    "game-ir",
    "package-system",
    "runtime-contracts",
    "target-profiles",
  ],
  provides: ["target-builds"],
  publicEntrypoints: ["src/index.ts"],
} as const;
