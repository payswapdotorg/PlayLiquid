/**
 * Cache admission tests (R6 aggressive caching; R15 streaming-policy
 * authority; E8 cache-rule violation and content-tamper refusals).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { planSparkBoot } from "./boot-plan.ts";
import { admitSparkCacheEntry, buildSparkCacheManifest, sparkCacheManifestDigestOf } from "./cache.ts";
import { fixtureCostModel, fixtureSparkDocument, fixtureSparkProfile } from "./fixtures.ts";

function derivedManifest(secondWorldCaching = true) {
  const plan = planSparkBoot(
    fixtureSparkDocument({ secondWorldCaching }),
    fixtureSparkProfile(),
    fixtureCostModel(),
  );
  if (!plan.ok) throw new Error(JSON.stringify(plan.rejections));
  const manifest = buildSparkCacheManifest(plan.plan);
  if (!manifest.ok) throw new Error(manifest.message);
  return { plan: plan.plan, manifest };
}

test("the manifest rules every unit of the plan, digest-pinned", () => {
  const { plan, manifest } = derivedManifest();
  assert.equal(manifest.kind, "spark-cache-manifest");
  assert.equal(manifest.rules.length, plan.criticalUnits.length + plan.deferredUnits.length);
  for (const rule of manifest.rules) {
    assert.match(rule.contentDigest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(rule.admission === "cache-eligible" || rule.admission === "must-revalidate");
  }
  // All units are cache-eligible here: every world streams cacheably.
  assert.ok(manifest.rules.every((rule) => rule.admission === "cache-eligible"));
  assert.ok(manifest.cacheableBytes > 0);
});

test("a world whose streaming policy refuses caching makes its units revalidate (R15)", () => {
  const { manifest } = derivedManifest(false);
  const revalidating = manifest.rules.filter((rule) => rule.admission === "must-revalidate");
  const ids = new Set(revalidating.map((rule) => rule.unitId));
  assert.deepEqual([...ids].sort(), [
    "entity-second-node",
    "rule-second",
    "scene-second-node",
    "world-second-node",
  ]);
});

test("manifest digests are deterministic and re-computable (E9/E10)", () => {
  const first = derivedManifest().manifest;
  const second = derivedManifest().manifest;
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(sparkCacheManifestDigestOf(first), first.manifestDigest);
  assert.notEqual(first.manifestDigest, derivedManifest(false).manifest.manifestDigest);
});

test("admission serves digest-pinned eligible units", () => {
  const { manifest } = derivedManifest();
  const rule = manifest.rules.find((entry) => entry.unitId === "world-spark-node")!;
  const admission = admitSparkCacheEntry(manifest, { unitId: rule.unitId, contentDigest: rule.contentDigest, bytes: 128 });
  assert.equal(admission.ok, true);
  if (admission.ok) {
    assert.equal(admission.action, "store-then-serve");
    assert.equal(admission.rule.unitId, rule.unitId);
  }
  const hit = admitSparkCacheEntry(manifest, { unitId: rule.unitId, contentDigest: rule.contentDigest, bytes: 128 }, { presentInCache: true });
  if (!hit.ok) throw new Error(hit.message);
  assert.equal(hit.action, "serve-from-cache");
});

test("an unknown unit is refused admission", () => {
  const { manifest } = derivedManifest();
  const refusal = admitSparkCacheEntry(manifest, { unitId: "ghost-node", contentDigest: manifest.rules[0]!.contentDigest, bytes: 1 });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "cache/unknown-unit");
  }
});

test("tampered content (digest mismatch) is refused (E8)", () => {
  const { manifest } = derivedManifest();
  const rule = manifest.rules.find((entry) => entry.unitId === "entity-hero-node")!;
  const refusal = admitSparkCacheEntry(manifest, {
    unitId: rule.unitId,
    contentDigest: `sha256:${"f".repeat(64)}`,
    bytes: 8,
  });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "cache/content-digest-mismatch");
  }
});

test("caching a must-revalidate unit is a cache-rule violation (E8)", () => {
  const { manifest } = derivedManifest(false);
  const rule = manifest.rules.find((entry) => entry.admission === "must-revalidate")!;
  const refusal = admitSparkCacheEntry(manifest, { unitId: rule.unitId, contentDigest: rule.contentDigest, bytes: 64 });
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "cache-rule-violation");
    assert.match(refusal.message, /cacheable: false/);
  }
});

test("a cache budget overflow is refused (E8)", () => {
  const { manifest } = derivedManifest();
  const rule = manifest.rules.find((entry) => entry.unitId === "world-spark-node")!;
  const refusal = admitSparkCacheEntry(
    manifest,
    { unitId: rule.unitId, contentDigest: rule.contentDigest, bytes: 128 },
    { cacheBudgetBytes: 100, currentlyCachedBytes: 0 },
  );
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "cache-budget-exceeded");
  }
  // A smaller unit still fits.
  const fits = admitSparkCacheEntry(
    manifest,
    { unitId: rule.unitId, contentDigest: rule.contentDigest, bytes: 128 },
    { cacheBudgetBytes: 256, currentlyCachedBytes: 128 },
  );
  assert.equal(fits.ok, true);
});
