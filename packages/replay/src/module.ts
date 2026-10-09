/**
 * replay 模块清单（PL-010 治理晋升）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 src/index.ts。
 */
export const replayModule = {
  id: "replay",
  requires: ["game-contracts", "game-ir", "package-system", "runtime-contracts"],
  provides: ["replay"],
  publicEntrypoints: ["src/index.ts"],
} as const;
