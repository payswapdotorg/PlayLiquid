/**
 * platform-identity 模块清单（PL-010 治理晋升格式）。
 * 依赖声明与 spec/module-dependency-matrix.md 行
 * `identity | Platform | platform-contracts` 保持一致；对外只暴露 src/index.ts。
 */
export const platform_identityModule = {
  id: "platform-identity",
  requires: ["platform-contracts"],
  provides: ["platform-identity"],
  publicEntrypoints: ["src/index.ts"],
} as const;
