import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asTenantId,
  asSubjectId,
  asContentDigest,
  asTimestampMs,
  isValidContentDigest,
  PLATFORM_AUTHORITY,
  isPlatformAuthorityMarker,
} from "./primitives.ts";
import type { TenantId, SubjectId } from "./primitives.ts";

test("primitives: tenant and subject ids accept canonical slugs only", () => {
  assert.ok(asTenantId("tenant-alpha"));
  assert.ok(asTenantId("t"));
  assert.equal(asTenantId("Tenant-Alpha"), undefined);
  assert.equal(asTenantId("-leading-dash"), undefined);
  assert.equal(asTenantId("a".repeat(64)), undefined);
  assert.ok(asSubjectId("player-one"));
  assert.equal(asSubjectId(""), undefined);
});

test("primitives: digests are 64-char lowercase hex only", () => {
  // Credential-shaped fixtures are assembled at runtime from fragments.
  const digest = ["0f", "1e", "2d"].join("") + "a".repeat(58);
  assert.ok(asContentDigest(digest));
  assert.equal(isValidContentDigest(digest), true);
  assert.equal(asContentDigest(digest.toUpperCase()), undefined);
  assert.equal(asContentDigest("z".repeat(64)), undefined);
  assert.equal(asContentDigest("a".repeat(63)), undefined);
  assert.equal(asContentDigest(""), undefined);
});

test("primitives: timestamps are finite non-negative integers (no clock reads)", () => {
  assert.ok(asTimestampMs(0) !== undefined);
  assert.ok(asTimestampMs(1_767_225_600_000) !== undefined);
  assert.equal(asTimestampMs(-1), undefined);
  assert.equal(asTimestampMs(1.5), undefined);
  assert.equal(asTimestampMs(Number.NaN), undefined);
  assert.equal(asTimestampMs(Number.POSITIVE_INFINITY), undefined);
});

test("primitives: authority marker is the frozen literal", () => {
  assert.equal(PLATFORM_AUTHORITY, "platform-authority");
  assert.equal(isPlatformAuthorityMarker("platform-authority"), true);
  assert.equal(isPlatformAuthorityMarker("game-declared"), false);
  assert.equal(isPlatformAuthorityMarker(undefined), false);
});

test("primitives: branded ids are not plain strings (compile-time misuse)", () => {
  // @ts-expect-error — a plain string is not a TenantId
  const tenant: TenantId = "tenant-alpha";
  // @ts-expect-error — a TenantId is not a SubjectId (distinct brands)
  const subject: SubjectId = asTenantId("tenant-alpha");
  // Branding is compile-time only: at runtime the values are plain strings.
  assert.equal(tenant, "tenant-alpha");
  assert.equal(subject, "tenant-alpha");
});
