import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  SOCIAL_GRAPH_KINDS,
  isSocialGraphKind,
  isSocialServicePolicy,
  isSocialEventBinding,
  SOCIAL_ACTIONS,
  isSocialAction,
  isSocialActionRequest,
  adjudicateSocialAction,
} from "./social.ts";
import type { SocialServicePolicy, SocialActionRequest, SocialGraphFacts } from "./social.ts";

const tenant = asTenantId("tenant-alpha")!;
const actor = asSubjectId("player-one")!;
const target = asSubjectId("player-two")!;
const kind = asGameEventKind("guild.member.joined")!;

const policy: SocialServicePolicy = {
  maxGraphSize: 2,
  requireMutualConsent: true,
  presence: true,
};

function request(action: SocialActionRequest["action"]): SocialActionRequest {
  return { tenant, action, graph: "guilds", actor, target };
}

function facts(overrides: Partial<SocialGraphFacts> = {}): SocialGraphFacts {
  const full: SocialGraphFacts = { graph: "guilds", declared: true, members: [actor] };
  return { ...full, ...overrides };
}

test("social: vocabularies are frozen and guards work", () => {
  assert.ok(Object.isFrozen(SOCIAL_GRAPH_KINDS));
  assert.ok(Object.isFrozen(SOCIAL_ACTIONS));
  assert.deepEqual([...SOCIAL_GRAPH_KINDS], ["friends", "guilds", "teams"]);
  assert.ok(isSocialGraphKind("guilds"));
  assert.equal(isSocialGraphKind("clans"), false);
  assert.ok(isSocialAction("befriend"));
  assert.equal(isSocialAction("block"), false);
});

test("social: service policies and event bindings validate", () => {
  assert.ok(isSocialServicePolicy(policy));
  assert.equal(isSocialServicePolicy({ ...policy, maxGraphSize: 1 }), false);
  assert.equal(isSocialServicePolicy({ ...policy, maxGraphSize: 1001 }), false);
  assert.ok(isSocialEventBinding({ capability: "social", eventKind: kind, graph: "guilds" }));
  assert.equal(isSocialEventBinding({ capability: "social", eventKind: kind, graph: "clans" }), false);
  assert.ok(isSocialActionRequest(request("join")));
  assert.equal(isSocialActionRequest({ ...request("join"), actor: "" }), false);
});

test("social: self-relation is refused (E8 negative path)", () => {
  const self = { ...request("befriend"), target: actor };
  assert.deepEqual(adjudicateSocialAction(self, policy, facts()), {
    accepted: false,
    code: "self-relation",
  });
});

test("social: acting on a graph the game never declared is refused (lock 18 negative path)", () => {
  assert.deepEqual(adjudicateSocialAction(request("join"), policy, facts({ declared: false })), {
    accepted: false,
    code: "graph-not-declared",
  });
});

test("social: unconsented befriending is refused under consent-requiring policies (E8)", () => {
  assert.deepEqual(adjudicateSocialAction(request("befriend"), policy, facts()), {
    accepted: false,
    code: "mutual-consent-required",
  });
  const consentFree: SocialServicePolicy = { ...policy, requireMutualConsent: false };
  assert.deepEqual(adjudicateSocialAction(request("befriend"), consentFree, facts()), { accepted: true });
});

test("social: full graphs refuse joins and invites (E8 negative path)", () => {
  const full = facts({ members: [actor, target] });
  assert.deepEqual(adjudicateSocialAction(request("join"), policy, full), {
    accepted: false,
    code: "graph-full",
  });
  assert.deepEqual(adjudicateSocialAction(request("invite"), policy, full), {
    accepted: false,
    code: "graph-full",
  });
});

test("social: leaving a graph one is not a member of is refused (E8 negative path)", () => {
  const notMember = facts({ members: [target] });
  assert.deepEqual(adjudicateSocialAction(request("leave"), policy, notMember), {
    accepted: false,
    code: "not-a-member",
  });
});

test("social: legitimate actions pass", () => {
  assert.deepEqual(adjudicateSocialAction(request("join"), policy, facts()), { accepted: true });
  assert.deepEqual(adjudicateSocialAction(request("leave"), policy, facts()), { accepted: true });
  assert.deepEqual(
    adjudicateSocialAction(request("unbefriend"), { ...policy, requireMutualConsent: false }, facts()),
    { accepted: true },
  );
});
