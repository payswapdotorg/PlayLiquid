/**
 * platform-social 模块清单（PL-010 治理晋升格式）。
 * 依赖声明与 spec/module-dependency-matrix.md 行
 * `social | Platform | platform-contracts, game-ir` 保持一致；对外只暴露 src/index.ts。
 */
export const platform_socialModule = {
  id: "platform-social",
  requires: ["platform-contracts", "game-ir"],
  provides: ["platform-social"],
  publicEntrypoints: ["src/index.ts"],
} as const;
