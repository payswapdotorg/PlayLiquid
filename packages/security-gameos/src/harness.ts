/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full security/rights journey over the deterministic rig
 * (the REAL dep services composed read-only behind the authority). Every
 * step — happy AND negative — is recorded with an expected and an actual
 * outcome:
 *
 *  1. R20: platform grant present → right granted (least privilege)
 *  2. R20/E8: ungranted subject → capability-not-granted
 *  3. R20/E8: cross-tenant probe → tenant-mismatch (oracle code verbatim)
 *  4. R5: surviving avatar capability → granted under the restriction
 *  5. R5/E8: host-restricted capability → restricted-by-host
 *  6. R5/E8: undeclared capability under the most permissive restriction →
 *     body-lacks-capability (a restriction can only ever REMOVE rights)
 *  7. Runtime arm: the broker-mediated right → granted via the frozen
 *     boundary evaluator
 *  8. E8: claiming another holder's grant → grant-holder-mismatch (verbatim)
 *  9. R20/E8: unbound session → session-unbound (structural tenancy)
 * 10. R11/E8: the suspended subject → suspended-by-integrity with the
 *     confidence band attached (certainty unrepresentable)
 * 11. E8: forged avatar definition digest → tampered-definition
 * 12. PL-011/R19: unlicensed record → license-unverified (verbatim);
 *     provenance gap → provenance-incomplete (verbatim)
 * 13. PL-011/E10: corrupted CAS bytes → integrity (verbatim, fail-closed)
 * 14. R10: declared event settles → authorized; undeclared →
 *     event-not-declared (verbatim)
 * 15. R10: the real entitlement's lifecycle action → authorized; unknown
 *     id → unknown-entitlement (verbatim)
 * 16. PL-031: the minted elevated review right → granted; unminted
 *     subject → no-elevated-right
 * 17. E10: re-running the same refusal → the recorded record (idempotent)
 * 18. E10: snapshot → fresh authority (SHARED store) → restore → the
 *     lattice re-enters liveness
 * 19. E9: constructing the rig twice → identical lattice-state digests
 *
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no live clock, no randomness.
 */

import {
  RIG_ADMIN,
  RIG_AVATAR_SUBJECT,
  RIG_CLEAN_SUBJECT,
  RIG_ECONOMY_OPERATOR,
  RIG_EVENT_KIND,
  RIG_FOREIGN_TENANT,
  RIG_HOST,
  RIG_OUTSIDER,
  RIG_PLAYER,
  RIG_REVIEWER,
  RIG_SESSION,
  RIG_SUSPENDED_SUBJECT,
  RIG_TENANT,
  createSecurityRig,
  rigStateDigest,
} from "./rig.ts";
import { RightsAuthority } from "./service.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

async function main(): Promise<void> {
  const rig = await createSecurityRig();
  const { authority } = rig;

  // 1. R20: a granted platform right.
  rig.platformGrants.grant({
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(RIG_PLAYER)!,
    capability: "rewards",
    permissions: ["read", "submit"],
  } satisfies ScopedCapabilityGrant);
  const granted = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_PLAYER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  record(
    "platform-right-granted",
    "granted:platform:rewards",
    granted.granted ? `granted:${granted.right.capability}` : `refused:${granted.code}`,
  );

  // 2. R20/E8: an ungranted subject.
  const ungranted = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  record(
    "ungranted-subject-refused",
    "refused:capability-not-granted",
    ungranted.granted ? "granted:unexpected" : `refused:${ungranted.code}`,
  );

  // 3. R20/E8: cross-tenant probe.
  const cross = authority.decide({
    tenant: RIG_FOREIGN_TENANT,
    subject: RIG_PLAYER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  record(
    "cross-tenant-probe-refused",
    "refused:tenant-mismatch",
    cross.granted ? "granted:unexpected" : `refused:${cross.code}`,
  );

  // 4-6. R5 avatar arm: survive / restricted / undeclared.
  const avatarCases: readonly [string, string, string][] = [
    ["avatar-movement-granted", "movement", "granted:avatar:movement"],
    ["avatar-speech-restricted", "speech", "refused:restricted-by-host"],
    ["avatar-undeclared-refused", "manipulation", "refused:body-lacks-capability"],
  ];
  for (const [name, capabilityId, expected] of avatarCases) {
    const result = authority.decide({
      tenant: RIG_TENANT,
      subject: RIG_AVATAR_SUBJECT,
      capability: { kind: "avatar", capability: capabilityId, host: RIG_HOST },
    });
    record(
      name,
      expected,
      result.granted ? `granted:${result.right.capability}` : `refused:${result.code}`,
    );
  }

  // 7. Runtime arm: the broker-mediated right.
  const runtime = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
    },
  });
  record(
    "runtime-right-granted",
    "granted:runtime:avatar.movement",
    runtime.granted ? `granted:${runtime.right.capability}` : `refused:${runtime.code}`,
  );

  // 8. E8: claiming another holder's grant.
  const stolen = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: RIG_SESSION, epoch: 1, tick: 5 },
      claimedGrantId: "grant-rig-other-holder",
    },
  });
  record(
    "stolen-grant-refused",
    "refused:grant-holder-mismatch",
    stolen.granted ? "granted:unexpected" : `refused:${stolen.code}`,
  );

  // 9. R20/E8: an unbound session.
  const unbound = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_AVATAR_SUBJECT,
    capability: {
      kind: "runtime",
      capability: "avatar.movement",
      actorClass: "avatar-agent",
      session: { tenant: RIG_TENANT, sessionId: "sess-rig-unbound", epoch: 1, tick: 5 },
    },
  });
  record(
    "unbound-session-refused",
    "refused:session-unbound",
    unbound.granted ? "granted:unexpected" : `refused:${unbound.code}`,
  );

  // 10. R11/E8: the suspended subject.
  const suspended = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_SUSPENDED_SUBJECT,
    capability: { kind: "avatar", capability: "movement", host: RIG_HOST },
  });
  record(
    "suspended-subject-refused",
    "refused:suspended-by-integrity",
    suspended.granted ? "granted:unexpected" : `refused:${suspended.code}`,
  );

  // 11. E8: a forged avatar definition digest.
  const forgedDefinition = { ...rig.avatarDefinition, definitionDigest: "f".repeat(64) as never };
  const forged = authority.registerAvatarBinding(RIG_ADMIN, {
    tenant: RIG_TENANT,
    host: "host-rig-forged",
    definition: forgedDefinition,
    restriction: rig.restriction,
  });
  record(
    "forged-definition-refused",
    "refused:tampered-definition",
    forged.ok ? "ok:unexpected" : `refused:${forged.code}`,
  );

  // 12. PL-011/R19: the release-gate refusals (codes verbatim).
  for (const [name, record_, expected] of [
    ["unlicensed-record-refused", rig.packages.unlicensed, "refused:license-unverified"],
    ["provenance-gap-refused", rig.packages.provenanceGap, "refused:provenance-incomplete"],
  ] as const) {
    const result = authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
      tenant: RIG_TENANT,
      kind: record_.identity.kind,
      id: record_.identity.id,
      version: `${record_.identity.version.major}.${record_.identity.version.minor}.${record_.identity.version.patch}`,
      contentDigest: record_.identity.contentDigest,
    });
    record(
      name,
      expected,
      result.admitted ? "admitted:unexpected" : `refused:${result.code}`,
    );
  }

  // 13. PL-011/E10: corrupted CAS bytes fail closed.
  rig.blobStore.corruptChunkForTests(rig.packages.good.identity.contentDigest, 0);
  const corrupted = authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
    tenant: RIG_TENANT,
    kind: rig.packages.good.identity.kind,
    id: rig.packages.good.identity.id,
    version: "1.0.0",
    contentDigest: rig.packages.good.identity.contentDigest,
  });
  record(
    "corrupted-cas-refused",
    "refused:integrity",
    corrupted.admitted ? "admitted:unexpected" : `refused:${corrupted.code}`,
  );

  // 14. R10: settlement authorization.
  const settle = authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: RIG_EVENT_KIND as never,
  });
  record(
    "settlement-authorized",
    "authorized:settle-event",
    settle.authorized ? `authorized:${settle.action}` : `refused:${settle.code}`,
  );
  const undeclared = authority.authorizeSettlement(RIG_PLAYER, RIG_TENANT, {
    kind: "settle-event",
    subject: RIG_CLEAN_SUBJECT,
    eventKind: "match.rig-undeclared" as never,
  });
  record(
    "undeclared-event-refused",
    "refused:event-not-declared",
    undeclared.authorized ? "authorized:unexpected" : `refused:${undeclared.code}`,
  );

  // 15. R10: the entitlement lifecycle authorization.
  rig.platformGrants.grant({
    tenant: asTenantId(RIG_TENANT)!,
    subject: asSubjectId(RIG_ECONOMY_OPERATOR)!,
    capability: "rewards",
    permissions: ["read", "administer"],
  } satisfies ScopedCapabilityGrant);
  const lifecycle = authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_CLEAN_SUBJECT,
    entitlement: rig.entitlementId,
  });
  record(
    "entitlement-lifecycle-authorized",
    "authorized:entitlement-lifecycle",
    lifecycle.authorized ? `authorized:${lifecycle.action}` : `refused:${lifecycle.code}`,
  );
  const unknownEntitlement = authority.authorizeSettlement(RIG_ECONOMY_OPERATOR, RIG_TENANT, {
    kind: "entitlement-lifecycle",
    subject: RIG_CLEAN_SUBJECT,
    entitlement: "entitlement-rig-unknown" as never,
  });
  record(
    "unknown-entitlement-refused",
    "refused:unknown-entitlement",
    unknownEntitlement.authorized ? "authorized:unexpected" : `refused:${unknownEntitlement.code}`,
  );

  // 16. PL-031: the elevated review right.
  const review = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_REVIEWER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  record(
    "elevated-review-granted",
    "granted:arena-escalated-review",
    review.granted ? `granted:${review.right.capability}` : `refused:${review.code}`,
  );
  const unminted = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
  });
  record(
    "unminted-review-refused",
    "refused:no-elevated-right",
    unminted.granted ? "granted:unexpected" : `refused:${unminted.code}`,
  );

  // 17. E10: an identical refusal is idempotent (the first record stands).
  const first = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  const second = authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_OUTSIDER,
    capability: { kind: "platform", capability: "rewards", permission: "submit" },
  });
  record(
    "refusal-idempotent",
    "refused:capability-not-granted+recorded",
    !first.granted && !second.granted && second.recorded !== undefined
      ? `refused:${second.code}+recorded`
      : first.granted || second.granted
        ? "granted:unexpected"
        : `refused:${second.code}+no-record`,
  );

  // 18. E10: snapshot → fresh authority over the SHARED store → restore.
  const snapshot = authority.snapshot(RIG_ADMIN, RIG_TENANT);
  const restored = snapshot.ok
    ? (() => {
        const secondAuthority = new RightsAuthority({
          clock: rig.clock.clock,
          store: rig.store.store,
          admins: rig.admins.admins,
          platformGrants: rig.platformGrants.directory,
          broker: {
            snapshot: () => ({
              grants: rig.broker.grants,
              policy: rig.broker.policy,
              ledger: rig.broker.ledger,
            }),
          },
          registry: rig.registry,
          artifacts: rig.artifacts,
          economy: {
            declarationsOf: () => [],
            entitlementIn: () => undefined,
          },
          integrity: { standingFor: () => ({ ok: false, code: "no-recorded-verdict" }) },
          escalations: { caseOf: () => ({ ok: false, code: "unknown-case" }) },
        });
        const outcome = secondAuthority.restore(RIG_ADMIN, RIG_TENANT, snapshot.snapshotId);
        const standing = secondAuthority.decide({
          tenant: RIG_TENANT,
          subject: RIG_REVIEWER,
          capability: { kind: "elevated-review", caseId: rig.arenaCaseId },
        });
        const detail = !outcome.ok
          ? `refused:${outcome.code}`
          : standing.granted
            ? "restored:elevated-review-live"
            : `restored:refused:${standing.code}`;
        return { ok: detail === "restored:elevated-review-live", detail };
      })()
    : { ok: false, detail: `refused:${snapshot.code}` };
  record("snapshot-restore-roundtrip", "restored:elevated-review-live", restored.detail);

  // 19. E9: constructing the rig twice yields identical lattice digests.
  const twin = await createSecurityRig();
  record(
    "rig-determinism",
    `identical:${rigStateDigest(rig)}`,
    `identical:${rigStateDigest(twin)}` === `identical:${rigStateDigest(rig)}`
      ? `identical:${rigStateDigest(twin)}`
      : `divergent:${rigStateDigest(twin)}`,
  );

  const failures = steps.filter((item) => item.expected !== item.actual);
  console.log(
    JSON.stringify({ harness: "security-gameos", ok: failures.length === 0, steps, failures }, null, 2),
  );
  if (failures.length > 0) process.exitCode = 1;
}

await main();
