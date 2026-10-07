import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest, asTimestampMs } from "./primitives.ts";
import { isAiPlayMode } from "./integrity.ts";
import {
  PARTICIPATION_DECLARATION_KINDS,
  isParticipationDeclarationKind,
  isParticipationModeDeclaration,
  isDeclaredAiParticipation,
  isAssistParticipation,
  isHumanParticipation,
  participationModeOf,
  declarationsAreCoherent,
} from "./participation.ts";
import type {
  HumanParticipationDeclaration,
  AssistParticipationDeclaration,
  DeclaredAiParticipationDeclaration,
  ParticipationModeDeclaration,
} from "./participation.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const operator = asSubjectId("operator-one")!;
const declaredAt = asTimestampMs(2_000)!;
const scopeDigest = asContentDigest("ab".repeat(32))!;
const policyDigest = asContentDigest("cd".repeat(32))!;

const human: HumanParticipationDeclaration = {
  declarationKind: "participation.human",
  tenant,
  subject,
  declaredAt,
};
const assist: AssistParticipationDeclaration = {
  declarationKind: "participation.assist",
  tenant,
  subject,
  declaredAt,
  assistScopeDigest: scopeDigest,
};
const declaredAi: DeclaredAiParticipationDeclaration = {
  declarationKind: "participation.declared-ai",
  tenant,
  subject,
  declaredAt,
  operator,
};

test("participation: the declaration vocabulary is frozen and disjoint", () => {
  assert.ok(Object.isFrozen(PARTICIPATION_DECLARATION_KINDS));
  assert.deepEqual([...PARTICIPATION_DECLARATION_KINDS], [
    "participation.human",
    "participation.assist",
    "participation.declared-ai",
  ]);
  assert.ok(isParticipationDeclarationKind("participation.human"));
  assert.equal(isParticipationDeclarationKind("participation.robot"), false);
  // The markers are pairwise disjoint literals — one declaration, one mode.
  const kinds = new Set<string>([human.declarationKind, assist.declarationKind, declaredAi.declarationKind]);
  assert.equal(kinds.size, 3);
});

test("participation: all three declaration shapes validate", () => {
  assert.ok(isParticipationModeDeclaration(human));
  assert.ok(isParticipationModeDeclaration(assist));
  assert.ok(isParticipationModeDeclaration(declaredAi));
  // Optional operating-policy digest on declared-AI.
  assert.ok(isParticipationModeDeclaration({ ...declaredAi, operatingPolicyDigest: policyDigest }));
  assert.ok(isHumanParticipation(human));
  assert.ok(isAssistParticipation(assist));
  assert.ok(isDeclaredAiParticipation(declaredAi));
  // The type guards are mutually exclusive.
  assert.equal(isHumanParticipation(assist), false);
  assert.equal(isAssistParticipation(declaredAi), false);
  assert.equal(isDeclaredAiParticipation(human), false);
});

test("participation: declarations never carry certainty or proof of mode", () => {
  // The human declaration has no "verified" / "attested" field to fake.
  assert.deepEqual(Object.keys(human).sort(), ["declarationKind", "declaredAt", "subject", "tenant"]);
  // @ts-expect-error — excess property: declarations cannot claim proof
  const rigged: HumanParticipationDeclaration = { ...human, verifiedHuman: true };
  assert.equal((rigged as unknown as Record<string, unknown>).verifiedHuman, true);
  // ...and the structural guard refuses unknown markers outright.
  assert.equal(isParticipationModeDeclaration({ ...human, declarationKind: "participation.bot" }), false);
});

test("participation: malformed declarations are refused (negative paths)", () => {
  assert.equal(isParticipationModeDeclaration({ ...assist, assistScopeDigest: "junk" as never }), false);
  assert.equal(isParticipationModeDeclaration({ ...assist, assistScopeDigest: undefined }), false);
  assert.equal(isParticipationModeDeclaration({ ...declaredAi, operator: "" }), false);
  assert.equal(
    isParticipationModeDeclaration({ ...declaredAi, operatingPolicyDigest: "junk" as never }),
    false,
  );
  assert.equal(isParticipationModeDeclaration({ ...human, subject: "" }), false);
  assert.equal(isParticipationModeDeclaration({ ...human, declaredAt: -1 as never }), false);
  assert.equal(isParticipationModeDeclaration({ ...human, declaredAt: 0.5 as never }), false);
  assert.equal(isParticipationModeDeclaration(null), false);
});

test("participation: declarations map losslessly onto the report-time vocabulary", () => {
  assert.equal(participationModeOf(human), "human");
  assert.equal(participationModeOf(assist), "ai-assisted");
  assert.equal(participationModeOf(declaredAi), "ai-autonomous");
  for (const declaration of [human, assist, declaredAi] as ParticipationModeDeclaration[]) {
    assert.ok(isAiPlayMode(participationModeOf(declaration)));
  }
});

test("participation: one subject cannot co-hold different-mode declarations", () => {
  assert.ok(declarationsAreCoherent(human, { ...human, declaredAt: asTimestampMs(3_000)! }));
  assert.equal(declarationsAreCoherent(human, assist), false);
  assert.equal(declarationsAreCoherent(assist, declaredAi), false);
  assert.equal(declarationsAreCoherent(declaredAi, human), false);
});

test("participation: declarations are readonly data (E1 compile check)", () => {
  const declaration: AssistParticipationDeclaration = assist;
  // @ts-expect-error — E1: contract fields are readonly
  declaration.assistScopeDigest = asContentDigest("ff".repeat(32))!;
  assert.equal(declaration.subject, subject);
});
