/**
 * THE WEB HOST COMPOSITION TESTS (PL-044) — the PL-033/034 mount contract
 * as ONE typed host document: composition + verification + E8 negative
 * refusals + E9 determinism.
 *
 * E11 HONESTY (stated plainly): the web host composition is DATA + TYPED
 * WIRING ONLY. There is no DOM, no rendering, no browser process and no
 * network anywhere in this tree — the executable proof that the REAL
 * stores, ports and view models behind these mounts work end-to-end
 * lives in the qa/browser journey suite (PL-043). This suite proves the
 * WIRING MODEL: which workbenches, which port seams, which providers,
 * and the environment truth (dom/rendering/network all false) that the
 * verifier REQUIRES a host document to carry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEB_HOST_WORKBENCHES,
  WORKBENCH_PORTS,
  WORKBENCH_STORE_FACTORIES,
  composeWebHost,
  verifyWebHostDocument,
} from "./web-host.ts";
import type { HostMount, WebHostDocument } from "./web-host.ts";

/** The honest topology's studio mount (one required seam, demo-fed). */
function studioMount(overrides?: Partial<HostMount>): HostMount {
  return {
    mountId: "mount-game-studio",
    workbench: "game-studio",
    ports: [{ port: "StudioDataPort", provider: { source: "demo-fixture", fixture: "demoStudioSnapshot" } }],
    rendered: false,
    ...overrides,
  };
}

/** The honest topology's lab mount (data seam demo-fed, command seam host-adapter). */
function labMount(overrides?: Partial<HostMount>): HostMount {
  return {
    mountId: "mount-gameos-lab",
    workbench: "gameos-lab",
    ports: [
      { port: "LabDataPort", provider: { source: "demo-fixture", fixture: "demoLabSnapshot" } },
      { port: "LabCommandPort", provider: { source: "host-adapter", adapter: "ops-lab-command-adapter" } },
    ],
    rendered: false,
    ...overrides,
  };
}

/** The honest topology's community mount. */
function communityMount(overrides?: Partial<HostMount>): HostMount {
  return {
    mountId: "mount-gameos-community",
    workbench: "gameos-community",
    ports: [
      { port: "CommunityDataPort", provider: { source: "demo-fixture", fixture: "demoCommunitySnapshot" } },
      { port: "CommunityCommandPort", provider: { source: "host-adapter", adapter: "ops-community-command-adapter" } },
    ],
    rendered: false,
    ...overrides,
  };
}

test("composition: the three workbenches of the honest topology mount and verify", () => {
  const host = composeWebHost([studioMount(), labMount(), communityMount()]);
  assert.ok(host.ok, host.ok ? "" : host.detail);
  if (host.ok) {
    assert.equal(host.value.mounts.length, 3);
    assert.deepEqual(host.value.truth, { dom: false, rendering: false, network: false });
    const verified = verifyWebHostDocument(host.value);
    assert.ok(verified.ok, verified.ok ? "" : verified.detail);
    assert.equal(verified.ok ? verified.value.mounts : 0, 3);
  }
});

test("E9: the host document is deterministic — the same mounts compose to the same content address, twice", () => {
  const compose = (): WebHostDocument => {
    const host = composeWebHost([studioMount(), labMount(), communityMount()]);
    assert.ok(host.ok);
    return host.ok ? host.value : { hostDigest: "", mounts: [], truth: { dom: false, rendering: false, network: false } };
  };
  const first = compose();
  const second = compose();
  assert.equal(first.hostDigest, second.hostDigest);
  assert.deepEqual(first.mounts, second.mounts);
});

test("vocabulary: the mount vocabulary mirrors the documented workbench seams and store factories", () => {
  assert.deepEqual([...WEB_HOST_WORKBENCHES], ["game-studio", "gameos-lab", "gameos-community"]);
  assert.deepEqual([...WORKBENCH_PORTS["game-studio"]], ["StudioDataPort"]);
  assert.deepEqual([...WORKBENCH_PORTS["gameos-lab"]], ["LabDataPort", "LabCommandPort"]);
  assert.deepEqual([...WORKBENCH_PORTS["gameos-community"]], ["CommunityDataPort", "CommunityCommandPort"]);
  assert.equal(WORKBENCH_STORE_FACTORIES["game-studio"], "createStudioStore");
  assert.equal(WORKBENCH_STORE_FACTORIES["gameos-lab"], "createLabStore");
  assert.equal(WORKBENCH_STORE_FACTORIES["gameos-community"], "createCommunityStore");
});

// ---------------------------------------------------------------------------
// E8 — typed composition/verification refusals (frozen vocabulary)
// ---------------------------------------------------------------------------

test("E8: an empty composition is a typed refusal (empty-mounts)", () => {
  const host = composeWebHost([]);
  assert.ok(!host.ok && host.code === "empty-mounts");
});

test("E8: an unknown workbench is a typed refusal (unknown-workbench)", () => {
  const host = composeWebHost([studioMount({ workbench: "game-arcade" as HostMount["workbench"] })]);
  assert.ok(!host.ok && host.code === "unknown-workbench");
});

test("E8: a missing required port binding is a typed refusal (missing-port-binding)", () => {
  const host = composeWebHost([labMount({ ports: [{ port: "LabDataPort", provider: { source: "demo-fixture", fixture: "demoLabSnapshot" } }] })]);
  assert.ok(!host.ok && host.code === "missing-port-binding");
  assert.ok(host.ok ? false : host.detail.includes("LabCommandPort"));
});

test("E8: an undocumented port seam is a typed refusal (unknown-port)", () => {
  const host = composeWebHost([studioMount({ ports: [{ port: "StudioTelemetryPort", provider: { source: "host-adapter", adapter: "x" } }] })]);
  assert.ok(!host.ok && host.code === "unknown-port");
});

test("E8: a duplicate mount id is a typed refusal (duplicate-mount)", () => {
  const host = composeWebHost([studioMount(), studioMount({ workbench: "gameos-lab" })]);
  assert.ok(!host.ok && host.code === "duplicate-mount");
});

test("E8: a duplicate port binding is a typed refusal (duplicate-port-binding)", () => {
  const host = composeWebHost([
    studioMount({
      ports: [
        { port: "StudioDataPort", provider: { source: "demo-fixture", fixture: "demoStudioSnapshot" } },
        { port: "StudioDataPort", provider: { source: "host-adapter", adapter: "ops-studio-adapter" } },
      ],
    }),
  ]);
  assert.ok(!host.ok && host.code === "duplicate-port-binding");
});

test("E8: an unknown demo fixture is a typed refusal (unknown-fixture)", () => {
  const host = composeWebHost([studioMount({ ports: [{ port: "StudioDataPort", provider: { source: "demo-fixture", fixture: "demoArcadeSnapshot" as "demoStudioSnapshot" } }] })]);
  assert.ok(!host.ok && host.code === "unknown-fixture");
});

test("E8: a mount claiming rendering is a typed honesty refusal (honesty-violation, E11)", () => {
  const host = composeWebHost([studioMount({ rendered: true as false })]);
  assert.ok(!host.ok && host.code === "honesty-violation");
  assert.ok(host.ok ? false : host.detail.includes("E11"));
});

test("E8: a document claiming DOM/network truth is a typed honesty refusal (honesty-violation, E11)", () => {
  const host = composeWebHost([studioMount()]);
  assert.ok(host.ok);
  if (host.ok) {
    // The hostile document LIES about the environment (claims a DOM). The
    // cast is the attacker's type lie — exactly what the verifier exists
    // to refuse (E11: this tree renders nothing, anywhere).
    const lying = { ...host.value, truth: { dom: true, rendering: false, network: false } } as unknown as WebHostDocument;
    const verified = verifyWebHostDocument(lying);
    assert.ok(!verified.ok && verified.code === "honesty-violation");
  }
});

test("E8: a tampered host document is a typed refusal (tampered-document)", () => {
  const host = composeWebHost([studioMount(), labMount(), communityMount()]);
  assert.ok(host.ok);
  if (host.ok) {
    const tampered = { ...host.value, hostDigest: "0".repeat(64) };
    const verified = verifyWebHostDocument(tampered);
    assert.ok(!verified.ok && verified.code === "tampered-document");
  }
});
