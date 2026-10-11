/**
 * engine-unreal 模块清单（PL-010 治理晋升格式；当前为 worker 交付态，
 * 由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * 依赖声明与 spec/work-items.md PL-022 行（Depends: PL-019, PL-020）的
 * 可实施部分一致：tool-fabric-runtime（PL-019 调用运行时 —— 本适配器被
 * 注册进去的宿主）、tool-fabric（PL-005 纯词汇，提供方中立操作清单的
 * 词汇层 —— 本适配器能力面从中裁剪）、engine-adapter-contract
 * （PL-005 中性 Adapter 契约 —— 本适配器实现的那道缝）。另有两项
 * 刻意直接声明（记录在工单报告）：
 * - target-profiles + build-contracts（PL-008/PL-020 交付物 —— 类型化
 *   UnrealEngineBinding 与冻结目标 profile 分类法 + 构建请求词汇的
 *   组合面，typed compatibility predicate 声明可服务的桌面级目标
 *   windows/macos/linux）；
 * - platform-contracts —— 租户隔离词汇（TenantId/SubjectId），
 *   tool-blender / engine-playcanvas 同款先例
 *   （R20 跨租户隔离纪律）。
 * 对外只暴露 src/index.ts。
 */
export const engine_unrealModule = {
  id: "engine-unreal",
  requires: [
    "build-contracts",
    "engine-adapter-contract",
    "platform-contracts",
    "target-profiles",
    "tool-fabric",
    "tool-fabric-runtime",
  ],
  provides: ["engine-unreal"],
  publicEntrypoints: ["src/index.ts"],
} as const;
