import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_EVENT_KIND_PREFIX,
  isValidEventKindText,
  isReservedPlatformEventKind,
  asGameEventKind,
  PLATFORM_AUTHORITY_EVENT_KINDS,
  isPlatformAuthorityEventKind,
  isGameDeclaredEvent,
  isPlatformAuthorityEvent,
  isGameSemanticEventDeclaration,
} from "./events.ts";
import type {
  GameDeclaredEvent,
  PlatformAuthorityEvent,
  GameEventKind,
  PlatformAuthorityEventKind,
} from "./events.ts";

test("events: game event kinds are dotted lowercase slugs", () => {
  assert.equal(isValidEventKindText("match.completed"), true);
  assert.equal(isValidEventKindText("shot.landed.critical"), true);
  assert.equal(isValidEventKindText("single"), true);
  assert.equal(isValidEventKindText("Match.Completed"), false);
  assert.equal(isValidEventKindText(".leading.dot"), false);
  assert.equal(isValidEventKindText("trailing.dot."), false);
  assert.equal(isValidEventKindText("a..double"), false);
  assert.equal(isValidEventKindText("a".repeat(128)), false);
});

test("events: the platform namespace is reserved (lock 18)", () => {
  assert.equal(PLATFORM_EVENT_KIND_PREFIX, "platform.");
  assert.equal(isReservedPlatformEventKind("platform.entitlement.granted"), true);
  assert.equal(isReservedPlatformEventKind("match.completed"), false);
  // The constructor REFUSES to mint reserved kinds as game event kinds.
  assert.equal(asGameEventKind("platform.entitlement.granted"), undefined);
  assert.equal(asGameEventKind("platform.leaderboard.rank.finalized"), undefined);
  // ...and refuses malformed text.
  assert.equal(asGameEventKind("NOT_A_KIND"), undefined);
  assert.equal(asGameEventKind(""), undefined);
  // ...while ordinary game kinds pass.
  assert.equal(asGameEventKind("match.completed"), "match.completed");
});

test("events: platform authority event vocabulary is frozen and non-trivial", () => {
  assert.ok(Object.isFrozen(PLATFORM_AUTHORITY_EVENT_KINDS));
  assert.ok(PLATFORM_AUTHORITY_EVENT_KINDS.length >= 9);
  for (const kind of PLATFORM_AUTHORITY_EVENT_KINDS) {
    assert.ok(kind.startsWith("platform."), `${kind} must sit in the reserved namespace`);
    assert.ok(isPlatformAuthorityEventKind(kind));
  }
  assert.equal(isPlatformAuthorityEventKind("platform.magic.certainty"), false);
  assert.equal(isPlatformAuthorityEventKind("match.completed"), false);
});

test("events: guards discriminate the two event shapes", () => {
  const gameEvent: GameDeclaredEvent<{ score: number }> = {
    origin: "game-declared",
    kind: asGameEventKind("match.completed")!,
    payload: { score: 42 },
  };
  const authorityEvent: PlatformAuthorityEvent<{ grant: string }> = {
    origin: "platform-authority",
    kind: "platform.entitlement.granted",
    decidedBy: "platform-authority",
    payload: { grant: "g-1" },
  };
  assert.ok(isGameDeclaredEvent(gameEvent));
  assert.equal(isPlatformAuthorityEvent(gameEvent), false);
  assert.ok(isPlatformAuthorityEvent(authorityEvent));
  assert.equal(isGameDeclaredEvent(authorityEvent), false);
  assert.equal(isGameDeclaredEvent(null), false);
  assert.equal(isPlatformAuthorityEvent({ origin: "platform-authority", kind: "platform.magic.certainty", decidedBy: "platform-authority" }), false);
});

test("events: a game-declared event cannot masquerade as a platform authority event (lock 18, compile-time)", () => {
  const gameEvent: GameDeclaredEvent = {
    origin: "game-declared",
    kind: asGameEventKind("match.completed")!,
    payload: {},
  };
  // @ts-expect-error — origin literals are disjoint ("game-declared" is not "platform-authority")
  const asAuthority: PlatformAuthorityEvent = gameEvent;
  // @ts-expect-error — a branded GameEventKind is not a frozen PlatformAuthorityEventKind literal
  const kindMismatch: PlatformAuthorityEventKind = gameEvent.kind;
  assert.equal(asAuthority.origin, "game-declared");
  assert.equal(typeof kindMismatch, "string");
});

test("events: a platform authority event is not a game-declared event either (compile-time)", () => {
  const authorityEvent: PlatformAuthorityEvent = {
    origin: "platform-authority",
    kind: "platform.entitlement.granted",
    decidedBy: "platform-authority",
    payload: {},
  };
  // @ts-expect-error — PlatformAuthorityEventKind is not assignable to the branded GameEventKind
  const kind: GameEventKind = authorityEvent.kind;
  // @ts-expect-error — origin literals are disjoint in this direction too
  const asGameEvent: GameDeclaredEvent = authorityEvent;
  assert.equal(typeof kind, "string");
  assert.equal(asGameEvent.origin, "platform-authority");
});

test("events: a raw string cannot be passed off as a declared game event kind (compile-time)", () => {
  // @ts-expect-error — plain strings must go through asGameEventKind
  const kind: GameEventKind = "match.completed";
  assert.equal(isReservedPlatformEventKind(kind), false);
});

test("events: event declarations require kind and summary", () => {
  assert.ok(isGameSemanticEventDeclaration({ kind: "match.completed", summary: "A match ended." }));
  assert.equal(isGameSemanticEventDeclaration({ kind: "match.completed", summary: "" }), false);
  assert.equal(isGameSemanticEventDeclaration({ kind: "", summary: "x" }), false);
  assert.equal(isGameSemanticEventDeclaration(null), false);
  // Shape-only guard: reserved kinds pass the guard; the POLICY validator
  // (policy.test.ts) rejects them with the reserved-platform-event-kind code.
  assert.ok(isGameSemanticEventDeclaration({ kind: "platform.entitlement.granted", summary: "spoof" }));
});
