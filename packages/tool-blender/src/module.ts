/**
 * tool-blender 模块清单（PL-010 治理晋升格式；当前为 worker 交付态，
 * 由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * 依赖声明与 spec/work-items.md PL-025 行（Depends: PL-019）的
 * 可实施部分一致：engine-adapter-contract（PL-005 中性 Adapter 契约
 * —— 本适配器实现的那道缝）、tool-fabric-runtime（PL-019 调用运行时
 * —— 本适配器被注册进去的宿主）、tool-fabric（PL-005 纯词汇，
 * 提供方中立操作清单的词汇层）。另有一项刻意直接声明（记录在工单
 * 报告）：platform-contracts —— 租户隔离词汇（TenantId/SubjectId），
 * platform-economy / lab-simulation 同款先例（R20 跨租户隔离纪律）。
 * 对外只暴露 src/index.ts。
 */
export const tool_blenderModule = {
  id: "tool-blender",
  requires: [
    "engine-adapter-contract",
    "tool-fabric-runtime",
    "tool-fabric",
    "platform-contracts",
  ],
  provides: ["tool-blender"],
  publicEntrypoints: ["src/index.ts"],
} as const;
