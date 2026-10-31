/**
 * build-contracts 模块清单（PL-010 治理晋升）。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 src/index.ts。
 *
 * ACR-001（2026-10-31，lock v1.1 修订 1）：target-profile 输入新增可选的
 * TYPED deliveryProfile（交付轴 TargetProfile 注册表 —— 与构建目标轴
 * BuildTargetId 相互独立）。注册表的单一定义点在 game-contracts（E1），
 * 本模块只消费（spec/acr/ACR-001 §3 "consumed by GameIR/runtime/build"）。
 * 该依赖为 ACR-001 Phase B（PLX-ARCH-003）的刻意直接声明，记录于工单
 * 报告；architecture-policy.yaml 的同步晋升属 TL 下一矩阵调和波次
 * （engine-playcanvas 模块清单同款先例）。
 */
export const build_contractsModule = {
  id: "build-contracts",
  requires: ["game-contracts", "game-ir", "package-system"],
  provides: ["build-contracts"],
  publicEntrypoints: ["src/index.ts"],
} as const;
