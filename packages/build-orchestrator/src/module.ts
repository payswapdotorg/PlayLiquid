/**
 * build-orchestrator 模块清单（PL-020）。
 * requires 与包 manifest 的 workspace 依赖一致（PL-010 治理同款格式）：
 * 构建编排运行在 build-contracts（PL-008 构建契约）、package-system
 * （PL-002 摘要/锁/解析权威）、package-registry（PL-011 注册表）、
 * target-profiles（PL-008 目标分类）、tool-fabric（PL-005 调用协议）
 * 与 tool-fabric-runtime（PL-019 运行时）之上；engine-adapter-contract
 * 仅为测试替身（fake-adapter）所用。对外只暴露 src/index.ts。
 */
export const build_orchestratorModule = {
  id: "build-orchestrator",
  requires: [
    "build-contracts",
    "engine-adapter-contract",
    "package-registry",
    "package-system",
    "target-profiles",
    "tool-fabric",
    "tool-fabric-runtime",
  ],
  provides: ["build-orchestrator"],
  publicEntrypoints: ["src/index.ts"],
} as const;
