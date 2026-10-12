/**
 * security-gameos 模块清单（PL-010 治理晋升格式）。
 *
 * requires 镜像本包实际 import 的全部 workspace 模块公共面：
 * - platform-contracts / runtime-contracts / game-contracts：冻结的
 *   租户、最小权限、能力协议与 R5 头像限制词汇（只 import 词汇与
 *   纯 oracle，从不重新实现）；
 * - avatar-runtime / capability-broker（PL-026）：R5 有效能力投影与
 *   经纪人授权表读取（grantsForActor / commandKindForIntent）；
 * - package-registry / artifact-store / package-system（PL-011）：准入
 *   门的 CAS/注册表只读验证面与发布门 oracle；
 * - platform-economy（PL-017）：R10 结算动作授权的只读权益面；
 * - platform-integrity（PL-018）：R11 证据标准摄入（rig 组合真实服务）；
 * - arena-integration-runtime（PL-031）：升级案件只读摄入（rig 组合）。
 *
 * 晋升进 architecture-policy.yaml 是 TL 合并时的动作；对外只暴露
 * src/index.ts。
 */
export const securityGameosModule = {
  id: "security-gameos",
  requires: [
    "arena-integration-runtime",
    "artifact-store",
    "avatar-runtime",
    "capability-broker",
    "game-contracts",
    "package-registry",
    "package-system",
    "platform-contracts",
    "platform-economy",
    "platform-integrity",
    "runtime-contracts",
  ],
  provides: ["security-gameos"],
  publicEntrypoints: ["src/index.ts"],
} as const;
