import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_CONTENT_DIGEST_PATTERN,
  ARENA_ENDPOINT_REF_KIND,
  ARENA_EXTERNAL_ORIGIN,
  asArenaContentDigest,
  asArenaTimestampMs,
  arenaEndpointRefEquals,
  arenaEndpointRefKey,
  frozenVocabulary,
  isArenaEndpointRef,
  isArenaExternalOriginMarker,
  isValidArenaContentDigest,
} from "./primitives.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";

/** Fixture digest builder: fragment-assembled, never a secret-shaped literal. */
function fixtureDigest(hexSeed: string): ArenaContentDigest {
  const hex = (hexSeed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

test("primitives: digests accept the package-system wire shape only", () => {
  const digest = fixtureDigest("abc");
  assert.ok(isValidArenaContentDigest(digest));
  assert.ok(asArenaContentDigest(digest) !== undefined);
  assert.match(digest, ARENA_CONTENT_DIGEST_PATTERN);
  assert.equal(asArenaContentDigest(digest.toUpperCase()), undefined);
  assert.equal(asArenaContentDigest("a".repeat(64)), undefined); // missing sha256: prefix
  assert.equal(asArenaContentDigest("sha256:" + "z".repeat(64)), undefined); // non-hex
  assert.equal(asArenaContentDigest("sha256:" + "a".repeat(63)), undefined); // too short
  assert.equal(asArenaContentDigest("sha256:" + "a".repeat(65)), undefined); // too long
  assert.equal(asArenaContentDigest(""), undefined);
});

test("primitives: timestamps are caller-supplied finite non-negative integers", () => {
  assert.ok(asArenaTimestampMs(0) !== undefined);
  assert.ok(asArenaTimestampMs(1_767_225_600_000) !== undefined);
  assert.equal(asArenaTimestampMs(-1), undefined);
  assert.equal(asArenaTimestampMs(1.5), undefined);
  assert.equal(asArenaTimestampMs(Number.NaN), undefined);
  assert.equal(asArenaTimestampMs(Number.POSITIVE_INFINITY), undefined);
});

test("primitives: endpoint refs are opaque digest-pinned records", () => {
  const endpoint: ArenaEndpointRef = {
    refKind: ARENA_ENDPOINT_REF_KIND,
    endpointDigest: fixtureDigest("e1"),
  };
  assert.ok(isArenaEndpointRef(endpoint));
  assert.equal(arenaEndpointRefKey(endpoint), endpoint.endpointDigest);
  assert.ok(arenaEndpointRefEquals(endpoint, { refKind: "arena-endpoint", endpointDigest: endpoint.endpointDigest }));
  assert.equal(
    arenaEndpointRefEquals(endpoint, { refKind: "arena-endpoint", endpointDigest: fixtureDigest("e2") }),
    false,
  );
  // Structural negatives: wrong kind marker and malformed digest are refused.
  assert.equal(isArenaEndpointRef({ refKind: "arena-internal", endpointDigest: endpoint.endpointDigest }), false);
  assert.equal(isArenaEndpointRef({ refKind: "arena-endpoint", endpointDigest: "sha256:not-hex" }), false);
  assert.equal(isArenaEndpointRef(null), false);
  assert.equal(isArenaEndpointRef("arena-endpoint"), false);
});

test("primitives: endpoint refs structurally cannot carry provider vocabulary", () => {
  const endpoint: ArenaEndpointRef = {
    refKind: ARENA_ENDPOINT_REF_KIND,
    endpointDigest: fixtureDigest("e1"),
    // @ts-expect-error — ArenaEndpointRef has no provider/vendor field; excess
    // property checking rejects any provider vocabulary at compile time.
    provider: "some-vendor",
  };
  // The runtime guard recognizes the digest-pinned identity and simply does
  // not look at any other key: vendor detail is structurally unrepresentable.
  assert.ok(isArenaEndpointRef(endpoint));
  assert.equal(arenaEndpointRefKey(endpoint), endpoint.endpointDigest);
});

test("primitives: arena-external provenance marker is the frozen literal", () => {
  assert.equal(ARENA_EXTERNAL_ORIGIN, "arena-external");
  assert.equal(isArenaExternalOriginMarker("arena-external"), true);
  assert.equal(isArenaExternalOriginMarker("platform-authority"), false);
  assert.equal(isArenaExternalOriginMarker("lab-evidence"), false);
  assert.equal(isArenaExternalOriginMarker(undefined), false);
});

test("primitives: frozen vocabularies are immutable with membership guards", () => {
  const vocab = frozenVocabulary("test-vocab", ["alpha", "beta"] as const);
  assert.equal(vocab.name, "test-vocab");
  assert.deepEqual(vocab.values, ["alpha", "beta"]);
  assert.equal(vocab.is("alpha"), true);
  assert.equal(vocab.is("gamma"), false);
  assert.equal(vocab.is(42), false);
  assert.equal(vocab.is(undefined), false);
  assert.throws(() => {
    (vocab.values as string[]).push("gamma");
  }, /read only|not extensible|Cannot add/i);
});

test("primitives: branded types are not plain strings (compile-time misuse)", () => {
  // @ts-expect-error — a plain string is not an ArenaContentDigest
  const digest: ArenaContentDigest = "sha256:" + "a".repeat(64);
  // @ts-expect-error — an ArenaContentDigest is not an ArenaTimestampMs (distinct brands)
  const stamp: ArenaTimestampMs = digest;
  // Branding is compile-time only: at runtime values are ordinary strings.
  assert.equal(typeof digest, "string");
  assert.equal(typeof stamp, "string");
});
