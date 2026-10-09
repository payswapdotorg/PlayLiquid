/**
 * capability-broker 模块清单（PL-026 交付；晋升为 managed 由 TL 在合并时执行）。
 * 依赖声明与 spec/module-dependency-matrix.md 设计意图一致：
 * 主依赖 game-ir（GameIR 政策派生），实现 runtime-contracts 的冻结能力协议。
 * 对外只暴露 src/index.ts。
 */
export const capability_brokerModule = {
  id: "capability-broker",
  requires: ["runtime-contracts", "game-ir"],
  provides: ["capability-broker"],
  publicEntrypoints: ["src/index.ts"],
} as const;
