/**
 * avatar-runtime 模块清单（PL-026 交付；晋升为 managed 由 TL 在合并时执行）。
 * 依赖声明与 spec/module-dependency-matrix.md 设计意图一致：
 * game-ir / capability-broker / runtime-contracts，另直接声明
 * game-contracts（冻结的 R5 头像能力词汇表所在）。对外只暴露 src/index.ts。
 */
export const avatar_runtimeModule = {
  id: "avatar-runtime",
  requires: ["game-contracts", "game-ir", "capability-broker", "runtime-contracts"],
  provides: ["avatar-runtime"],
  publicEntrypoints: ["src/index.ts"],
} as const;
