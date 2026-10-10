/**
 * lab-simulation 模块清单（PL-010 治理晋升格式；当前为 worker 交付态，
 * 由 TL 在晋升波次中写入 architecture-policy.yaml）。
 *
 * 依赖声明与 spec/work-items.md PL-028 行（Depends: PL-006, PL-014,
 * PL-026）的可实施部分一致：lab-contracts、simulation、replay、
 * avatar-runtime、capability-broker。另有三项刻意直接声明（记录在
 * 工单报告）：
 * - game-contracts：冻结的 id/ref 词汇（AgentId/EntityRef/GitRef/
 *   GameIdentity），lab-contracts 与 simulation 均以它为词汇层 ——
 *   沿 avatar-runtime 直接声明 game-contracts 的先例；
 * - platform-contracts：租户隔离词汇（TenantId/SubjectId/
 *   checkTenantIsolation）—— platform-economy/community 同款先例；
 * - package-system：canonical JSON 权威（内容寻址身份的序列化层），
 *   community 同款先例（computeDigest 为摘要权威；本包在自身接缝处
 *   用 canonicalJson + sha256 派生身份，与 replay 包先例一致）；
 * - game-ir：模拟世界值层的词汇（GameIRValue/GameEvent/
 *   asEventTypeId）—— simulation/kernel 的 WorldState 即建在其上，
 *   simulation、avatar-runtime、capability-broker 均直接声明先例；
 * - runtime-contracts：会话/演员/授权/命令词汇（SessionId/ActorId/
 *   CapabilityGrant/asCommandId 等）—— broker 授权表与 session 接缝
 *   需要，simulation、avatar-runtime、capability-broker 同款先例。
 * 对外只暴露 src/index.ts。
 */
export const lab_simulationModule = {
  id: "lab-simulation",
  requires: [
    "lab-contracts",
    "simulation",
    "replay",
    "avatar-runtime",
    "capability-broker",
    "game-contracts",
    "game-ir",
    "runtime-contracts",
    "platform-contracts",
    "package-system",
  ],
  provides: ["lab-simulation"],
  publicEntrypoints: ["src/index.ts"],
} as const;
