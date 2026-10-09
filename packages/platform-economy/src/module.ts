/**
 * platform-economy 模块清单（PL-010 治理晋升格式）。
 * 依赖声明与 spec/module-dependency-matrix.md 行
 * `economy | Platform | platform-contracts, integrity` 的可实施部分保持
 * 一致：platform-contracts 是已合并的依赖；integrity（PL-018，未合并）
 * 以纯端口接缝（src/integrity-port.ts 的 RewardIntegrityPort）承载，
 * 由宿主后续接线 —— 绝不依赖不存在的包，也不建立第二完整性权威。
 * 对外只暴露 src/index.ts。
 */
export const platform_economyModule = {
  id: "platform-economy",
  requires: ["platform-contracts"],
  provides: ["platform-economy"],
  publicEntrypoints: ["src/index.ts"],
} as const;
