/**
 * lab-learning 模块清单（PL-010 治理晋升格式；当前为 worker 交付态，
 * 由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * 依赖声明与 spec/work-items.md PL-030 行（Depends: PL-028, PL-029）的
 * 可实施部分一致：lab-simulation（PL-028 —— 评估运行记录与校准接缝的
 * 产出，本包只消费、绝不重新推导）、lab-organization（PL-029 —— 本包
 * 的引导对象所参数化的那条搜索请求面，其候选蓝图/搜索结果词汇只从
 * 公共入口导入，绝不复制其编译器）。另有三项刻意直接声明（记录在
 * 工单报告中）：
 * - lab-contracts：冻结的证据/缺口阶梯/估计标记词汇（PL-006），本包
 *   的词汇层，绝不二次声明；
 * - game-contracts：冻结的 id/ref 词汇（GameIdentity/GitRef），
 *   lab-simulation / lab-organization 直接声明先例；
 * - platform-contracts：租户隔离词汇（TenantId/SubjectId/
 *   checkTenantIsolation，R20）—— platform-economy / lab-simulation
 *   同款先例；
 * - package-system：canonical JSON 权威（内容寻址身份的序列化层），
 *   lab-simulation / lab-organization 同款先例。
 * 对外只暴露 src/index.ts。
 */
export const lab_learningModule = {
  id: "lab-learning",
  requires: [
    "lab-contracts",
    "lab-simulation",
    "lab-organization",
    "game-contracts",
    "platform-contracts",
    "package-system",
  ],
  provides: ["lab-learning"],
  publicEntrypoints: ["src/index.ts"],
} as const;
