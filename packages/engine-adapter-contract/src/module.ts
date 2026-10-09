/**
 * engine-adapter-contract 模块清单（PL-010 治理晋升）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 src/index.ts。
 */
export const engine_adapter_contractModule = {
  id: "engine-adapter-contract",
  requires: [],
  provides: ["engine-adapter-contract"],
  publicEntrypoints: ["src/index.ts"],
} as const;
