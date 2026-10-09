/**
 * git-lineage 模块清单（PL-010 治理晋升）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 src/index.ts。
 */
export const git_lineageModule = {
  id: "git-lineage",
  requires: ["game-ir", "package-system"],
  provides: ["git-lineage"],
  publicEntrypoints: ["src/index.ts"],
} as const;
