/**
 * qa/security PUBLIC ENTRYPOINT (PL-041) — the cross-system NEGATIVE
 * (adversarial) suite for the security/rights authority.
 *
 * Every test drives the REAL public surface of the security-gameos
 * package (the RightsAuthority over the deterministic rig of REAL
 * sibling services) through hostile moves only: forged grants and
 * digest pins, forged integrity markers, tampered command/CAS streams,
 * privilege-escalation attempts, R5 restriction bypasses, cross-tenant
 * select/read/write and tenant-confusion via crafted ids, entitlement
 * forgery and settlement/declaration mismatches, evidence tampering
 * and verdict-edit attempts, and append-only ledger/snapshot
 * violations. Every refusal is asserted with its TYPED code VERBATIM
 * (E8) plus its refusal-ledger record (E10) wherever the door is an
 * adjudication door.
 *
 * E11 honesty: this suite runs under plain `node --test` — no network,
 * no real filesystem persistence, no live clocks (all time is the rig's
 * fixed clock); every adversarial move is an in-memory construction.
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// Module manifest (PL-010 governance format)
export { qaSecurityModule } from "./module.ts";

// The system under test, reached ONLY through its public entrypoint.
export {
  RightsAuthority,
  brokerSnapshotOf,
  createSecurityRig,
  documentOf,
  ledgerIsAppendOnly,
  rigStateDigest,
  rightsAdminGrant,
  rightsAuditorGrant,
  snapshotOf,
  RIG_ADMIN,
  RIG_AUDITOR,
  RIG_AVATAR_SUBJECT,
  RIG_CLEAN_SUBJECT,
  RIG_ECONOMY_OPERATOR,
  RIG_ECONOMY_READER,
  RIG_EVENT_KIND,
  RIG_FOREIGN_TENANT,
  RIG_HOST,
  RIG_INTEGRITY_OPERATOR,
  RIG_OTHER_HOLDER,
  RIG_OUTSIDER,
  RIG_PLAYER,
  RIG_REVIEWER,
  RIG_SESSION,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
} from "../../../packages/security-gameos/src/index.ts";
export type { SecurityRig } from "../../../packages/security-gameos/src/index.ts";

// The adversarial kit (typed-code + ledger-record assertion helpers).
export { assertRefusalLedgered, decideOf } from "./adversary-kit.ts";
