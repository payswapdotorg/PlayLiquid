/**
 * platform-integrity 模块清单（PL-010 治理晋升格式）。
 * 依赖声明与 spec/module-dependency-matrix.md 设计意图行
 * `integrity | Platform | replay, runtime-contracts` 保持一致，并按
 * 已实现兄弟服务（platform-multiplayer）的先例补上 platform-contracts
 * （冻结的完整性契约面所在）；对外只暴露 src/index.ts。
 */
export const platform_integrityModule = {
  id: "platform-integrity",
  requires: ["platform-contracts", "replay", "runtime-contracts"],
  provides: ["platform-integrity"],
  publicEntrypoints: ["src/index.ts"],
} as const;
