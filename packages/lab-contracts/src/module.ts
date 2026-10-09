/**
 * lab-contracts 模块清单（PL-010 治理晋升）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 src/index.ts。
 */
export const lab_contractsModule = {
  id: "lab-contracts",
  requires: ["game-contracts", "game-ir"],
  provides: ["lab-contracts"],
  publicEntrypoints: ["src/index.ts"],
} as const;
