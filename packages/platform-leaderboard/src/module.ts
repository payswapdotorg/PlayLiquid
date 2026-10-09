/**
 * platform-leaderboard 模块清单（PL-010 治理晋升格式）。
 * 依赖声明与 spec/module-dependency-matrix.md 行
 * `leaderboard | Platform | platform-contracts` 保持一致；对外只暴露 src/index.ts。
 */
export const platform_leaderboardModule = {
  id: "platform-leaderboard",
  requires: ["platform-contracts"],
  provides: ["platform-leaderboard"],
  publicEntrypoints: ["src/index.ts"],
} as const;
