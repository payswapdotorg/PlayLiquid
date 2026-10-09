/**
 * tool-fabric-runtime 模块清单（PL-019）。
 * requires 与包 manifest 的 workspace 依赖一致（PL-010 治理同款格式）：
 * 运行时构建在 tool-fabric 调用协议/描述符与 engine-adapter-contract
 * 中性适配器契约之上；对外只暴露 src/index.ts。
 */
export const tool_fabric_runtimeModule = {
  id: "tool-fabric-runtime",
  requires: ["tool-fabric", "engine-adapter-contract"],
  provides: ["tool-fabric-runtime"],
  publicEntrypoints: ["src/index.ts"],
} as const;
