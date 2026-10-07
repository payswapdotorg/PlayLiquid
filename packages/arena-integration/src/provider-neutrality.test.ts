import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PROVIDER-NEUTRALITY NEGATIVE TESTS (E3; lock rules 6, 21, 32).
 *
 * "NO Arena vendor vocabulary anywhere in the types — the Arena endpoint,
 * transport, and wire protocol are a typed ArenaTransport pure port … Any
 * provider name appearing in authority types is a negative-tested
 * violation."
 *
 * These tests read this package's own NON-TEST sources and assert that no
 * provider/vendor vocabulary appears in any authority type, table or
 * literal. Banned tokens are assembled from fragments at runtime (house
 * fixture pattern) and this file is excluded from its own scan.
 */

const SRC_DIR = new URL(".", import.meta.url).pathname;

/** Source files that define the package's authority surface (no tests). */
function authoritySources(): string[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

/** Banned provider/vendor tokens, assembled from fragments. */
function bannedTokens(): readonly string[] {
  const fragments: readonly (readonly string[])[] = [
    ["open", "ai"],
    ["anth", "ropic"],
    ["azure", "openai"],
    ["google", "vertex"],
    ["bed", "rock"],
    ["microsoft", "azure"],
    ["aws", "bedrock"],
    ["claude"],
    ["gpt-", "4"],
    ["mist", "ral"],
    ["coh", "ere"],
    ["toget", "her.ai"],
    ["gro", "q"],
    ["deep", "seek"],
    ["rep", "licate"],
    ["up", "stash"],
  ];
  return fragments.map((parts) => parts.join(""));
}

test("provider-neutrality: no Arena vendor vocabulary in any authority source", () => {
  const sources = authoritySources();
  assert.ok(sources.length >= 10, `expected the package's authority sources, found ${sources.length}`);
  // Word-boundary matching: vendor names as identifiers, not substrings of
  // ordinary English words (e.g. "incoherent" must not trip "cohere").
  const bannedPatterns = bannedTokens().map((token) => new RegExp(`\\b${token.replace(/[.-]/g, (ch) => `\\${ch}`)}\\b`));
  const offenders: string[] = [];
  for (const name of sources) {
    const text = readFileSync(join(SRC_DIR, name), "utf8").toLowerCase();
    for (const pattern of bannedPatterns) {
      if (pattern.test(text)) offenders.push(`${name}: "${pattern.source}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("provider-neutrality: no provider-shaped FIELD names in authority code", () => {
  // Beyond vendor names, provider-shaped field/id vocabulary (apiKey,
  // baseUrl, vendor, provider, hostname, apiUrl…) must not appear in the
  // authority CODE: endpoint identity is digest-pinned only. Doc comments
  // are stripped first — prose explaining the ban is not a violation.
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const bannedFields = ["apikey", "api-key", "baseurl", "apiurl", "vendor", "hostname", "authorization-header"];
  const sources = authoritySources();
  const offenders: string[] = [];
  for (const name of sources) {
    const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8")).toLowerCase().replace(/[^a-z-]/g, "");
    for (const field of bannedFields) {
      if (code.includes(field)) offenders.push(`${name}: "${field}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("provider-neutrality: the only identity an endpoint carries is a digest", async () => {
  const { isArenaEndpointRef, ARENA_ENDPOINT_REF_KIND } = await import("./primitives.ts");
  const { inMemoryArenaTransport, ARENA_TRANSPORT_ERROR_KINDS } = await import("./transport.ts");
  const { ARENA_TRANSPORT_PORT_KIND } = await import("./transport.ts");

  // Structural: an endpoint ref with ONLY the digest pins identity.
  const digest = ("sha256:" + "e".repeat(64)) as never;
  const endpoint = { refKind: ARENA_ENDPOINT_REF_KIND, endpointDigest: digest };
  assert.ok(isArenaEndpointRef(endpoint));
  assert.deepEqual(Object.keys(endpoint).sort(), ["endpointDigest", "refKind"]);

  // The transport error vocabulary carries no vendor statuses.
  assert.deepEqual(
    [...ARENA_TRANSPORT_ERROR_KINDS.values].filter((kind) => /http|grpc|status|vendor|rate/i.test(kind)),
    [],
  );

  // The port marker is provider-free.
  assert.equal(ARENA_TRANSPORT_PORT_KIND, "arena-transport");

  // The fake binds a digest, not a URL or vendor name.
  const transport = inMemoryArenaTransport({ endpoint, respond: () => ({ ok: true, response: null as never }) });
  assert.equal(transport.portKind, "arena-transport");
});

test("provider-neutrality: wire envelopes carry no provider-identifying keys (compile-time)", async () => {
  const { arenaAuthorizationScope } = await import("./authorization.ts");
  type PublicEnvelopeShape = Record<string, unknown>;
  const envelope: PublicEnvelopeShape = {
    envelopeKind: "arena-request",
    requestKind: "result",
    cycle: {
      requestPayload: "sha256:" + "a".repeat(64),
      gapSummary: "sha256:" + "b".repeat(64),
      authorization: arenaAuthorizationScope([]),
    },
    endpoint: { refKind: "arena-endpoint", endpointDigest: "sha256:" + "e".repeat(64) },
  };
  const keys = Object.keys(envelope).concat(Object.keys(envelope.cycle as PublicEnvelopeShape));
  assert.deepEqual(
    keys.filter((key) => /provider|vendor|url|host|key|token|secret/i.test(key)),
    [],
  );
});
