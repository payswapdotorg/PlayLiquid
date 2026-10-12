/**
 * arena-integration-runtime 模块清单（PL-010 治理晋升格式；当前为 worker
 * 交付态，由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * 依赖声明与 spec/work-items.md PL-031 行（Depends: PL-007, PL-030）的可
 * 实施部分一致：arena-integration（PL-007 —— 本运行时所执行的类型化
 * provider-neutral 契约层，其词汇只从公共入口导入、绝不复制）、
 * lab-learning（PL-030 —— 按阶梯rung分类的复现缺口摘要，宿主决策的升级
 * 来源之一）。另有四项刻意直接声明（记录在交付报告中）：
 * - lab-contracts：冻结的缺口阶梯 / ArenaEscalationRef / 证据-估计认识
 *   论词汇（PL-006）—— 待决 PL-007 ACR 接缝的对接侧，绝不二次声明；
 * - lab-organization：类型化缺口发现记录与 gapFindingDigestOf 摘要oracle
 *   （PL-029）—— 只消费、绝不复制其编译器/搜索；
 * - game-contracts：冻结的 id/ref 词汇（Brand/isValidIdText）—— 家族先例；
 * - platform-contracts：租户隔离词汇（TenantId/SubjectId/
 *   checkTenantIsolation，R20）—— platform-economy / lab-learning 同款
 *   先例；
 * - package-system：canonical JSON 权威（内容寻址身份的序列化层）——
 *   lab-simulation / lab-organization / lab-learning 同款先例。
 * 对外只暴露 src/index.ts。
 */
export const arena_integration_runtimeModule = {
  id: "arena-integration-runtime",
  requires: [
    "arena-integration",
    "lab-learning",
    "lab-contracts",
    "lab-organization",
    "game-contracts",
    "platform-contracts",
    "package-system",
  ],
  provides: ["arena-integration-runtime"],
  publicEntrypoints: ["src/index.ts"],
} as const;
