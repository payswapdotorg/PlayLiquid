/**
 * lab-organization 模块清单（PL-010 治理晋升格式；当前为 worker 交付态，
 * 由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * 依赖声明与 spec/work-items.md PL-029 行（Depends: PL-006, PL-026,
 * PL-028）的可实施部分一致：lab-contracts（冻结的组织词汇 + 缺口阶梯 +
 * 评估契约 —— 本包的词汇层，绝不二次声明）、avatar-runtime（组合化身
 * 定义 + R5 限制投影 —— 槽位解析所依据的身体/能力表面）、lab-simulation
 * （PL-028 确定性评估引擎 —— 候选组织被求值所经由的那条路）。另有三项
 * 刻意直接声明（记录在工单报告）：
 * - game-contracts：冻结的 id/ref 词汇（AgentId/GameIdentity/
 *   HostRestriction），lab-simulation / avatar-runtime 直接声明先例；
 * - platform-contracts：租户隔离词汇（TenantId/SubjectId/
 *   checkTenantIsolation）—— platform-economy / lab-simulation 同款
 *   先例（R20 跨租户隔离纪律）；
 * - package-system：canonical JSON 权威（内容寻址身份的序列化层），
 *   lab-simulation / community 同款先例（本包在自身接缝处用
 *   canonicalJson + sha256 派生身份）。
 * 对外只暴露 src/index.ts。
 */
export const lab_organizationModule = {
  id: "lab-organization",
  requires: [
    "lab-contracts",
    "avatar-runtime",
    "lab-simulation",
    "game-contracts",
    "platform-contracts",
    "package-system",
  ],
  provides: ["lab-organization"],
  publicEntrypoints: ["src/index.ts"],
} as const;
