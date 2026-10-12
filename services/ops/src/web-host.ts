/**
 * THE WEB HOST COMPOSITION (PL-044) — the PL-033/034 mount contract
 * realized as ONE typed host document.
 *
 * E11 HONESTY (stated plainly, never faked): this composition is DATA +
 * TYPED WIRING ONLY. There is no DOM, no rendering, no browser process
 * and no network anywhere in this tree — the executable proof that the
 * REAL stores, ports and view models work end-to-end lives in the
 * qa/browser journey suite (PL-043); this service composes the HOST
 * WIRING MODEL a vite host instantiates, not a rendered page. The
 * document itself carries the environment truth (`dom: false`,
 * `rendering: false`, `network: false`) and the VERIFIER refuses any
 * document that claims otherwise (typed `honesty-violation`) — a host
 * model that pretends a browser exists here cannot verify.
 *
 * The mount recipe (the vocabulary mirrors the documented public
 * contracts of game-ui / gameos-lab / gameos-community, PL-033/034): a
 * host mounts each workbench by (1) providing its documented port seams
 * (the data port — and the command port where the workbench has one)
 * from a demo fixture or a host adapter, (2) creating the workbench's
 * ONE UI-state owner (its store factory), and (3) rendering the shell —
 * step (3) is the browser host's concern, recorded here as `rendered:
 * false` truth, never simulated.
 */

import { opsWebHostDigestOf } from "./digest.ts";

/** Every mountable workbench (frozen vocabulary). */
export const WEB_HOST_WORKBENCHES = Object.freeze(["game-studio", "gameos-lab", "gameos-community"] as const);

/** One mountable workbench id. */
export type WebHostWorkbench = (typeof WEB_HOST_WORKBENCHES)[number];

/** Type guard over {@link WebHostWorkbench}. */
export function isWebHostWorkbench(value: unknown): value is WebHostWorkbench {
  return typeof value === "string" && (WEB_HOST_WORKBENCHES as readonly string[]).includes(value);
}

/** The documented port seams each workbench requires (frozen map). */
export const WORKBENCH_PORTS: Readonly<Record<WebHostWorkbench, readonly string[]>> = Object.freeze({
  "game-studio": Object.freeze(["StudioDataPort"]),
  "gameos-lab": Object.freeze(["LabDataPort", "LabCommandPort"]),
  "gameos-community": Object.freeze(["CommunityDataPort", "CommunityCommandPort"]),
});

/** The documented ONE-store factory of each workbench (frozen map). */
export const WORKBENCH_STORE_FACTORIES: Readonly<Record<WebHostWorkbench, string>> = Object.freeze({
  "game-studio": "createStudioStore",
  "gameos-lab": "createLabStore",
  "gameos-community": "createCommunityStore",
});

/** The documented demo fixtures a port binding may provide (frozen). */
export const WEB_HOST_DEMO_FIXTURES = Object.freeze([
  "demoStudioSnapshot",
  "demoLabSnapshot",
  "demoCommunitySnapshot",
] as const);

/** One demo fixture name. */
export type WebHostDemoFixture = (typeof WEB_HOST_DEMO_FIXTURES)[number];

/** Type guard over {@link WebHostDemoFixture}. */
export function isWebHostDemoFixture(value: unknown): value is WebHostDemoFixture {
  return typeof value === "string" && (WEB_HOST_DEMO_FIXTURES as readonly string[]).includes(value);
}

/** What provides one port seam: a demo fixture, or the host's own adapter. */
export type PortProvider =
  | { readonly source: "demo-fixture"; readonly fixture: WebHostDemoFixture }
  | { readonly source: "host-adapter"; readonly adapter: string };

/** One port-seam binding of one mount. */
export interface PortBinding {
  readonly port: string;
  readonly provider: PortProvider;
}

/** One workbench mount of the host composition. */
export interface HostMount {
  readonly mountId: string;
  readonly workbench: WebHostWorkbench;
  readonly ports: readonly PortBinding[];
  /** Truth: nothing is rendered in this composition (E11). */
  readonly rendered: false;
}

/** The E11 environment truth every host document carries (all-false). */
export interface WebHostEnvironmentTruth {
  readonly dom: false;
  readonly rendering: false;
  readonly network: false;
}

/** The ONE host document (content-addressed). */
export interface WebHostDocument {
  readonly hostDigest: string;
  readonly mounts: readonly HostMount[];
  readonly truth: WebHostEnvironmentTruth;
}

/** The composition/verification refusal vocabulary (frozen). */
export type WebHostRefusalCode =
  | "empty-mounts"
  | "invalid-mount-id"
  | "duplicate-mount"
  | "unknown-workbench"
  | "missing-port-binding"
  | "unknown-port"
  | "unknown-fixture"
  | "duplicate-port-binding"
  | "honesty-violation"
  | "tampered-document";

/** Result of composing or verifying a host document. */
export type WebHostResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: WebHostRefusalCode; readonly detail: string };

/** The E11 environment truth (the only value that can verify). */
export const WEB_HOST_TRUTH: WebHostEnvironmentTruth = Object.freeze({ dom: false, rendering: false, network: false });

/** Composes and verifies ONE host document from the mount wiring (E9 deterministic). */
export function composeWebHost(mounts: readonly HostMount[]): WebHostResult<WebHostDocument> {
  const verification = verifyMounts(mounts);
  if (!verification.ok) return verification;
  const host: WebHostDocument = Object.freeze({
    hostDigest: opsWebHostDigestOf({ mounts }),
    mounts: Object.freeze([...mounts]),
    truth: WEB_HOST_TRUTH,
  });
  return { ok: true, value: host };
}

/** Verifies a composed host document (structure + content address + truth). */
export function verifyWebHostDocument(
  host: WebHostDocument,
): WebHostResult<{ readonly mounts: number }> {
  if (host.truth === undefined || host.truth.dom !== false || host.truth.rendering !== false || host.truth.network !== false) {
    return { ok: false, code: "honesty-violation", detail: "a web host document may not claim DOM, rendering or network — this composition is wiring data only (E11)" };
  }
  const mounts = verifyMounts(host.mounts);
  if (!mounts.ok) return mounts;
  const digest = opsWebHostDigestOf({ mounts: host.mounts });
  if (digest !== host.hostDigest) {
    return { ok: false, code: "tampered-document", detail: "the host document no longer matches its content-addressed digest (E8)" };
  }
  return { ok: true, value: { mounts: host.mounts.length } };
}

function verifyMounts(mounts: readonly HostMount[]): WebHostResult<readonly HostMount[]> {
  if (mounts.length === 0) return { ok: false, code: "empty-mounts", detail: "a host composition mounts at least one workbench" };
  const seenMountIds = new Set<string>();
  for (const mount of mounts) {
    if (typeof mount.mountId !== "string" || mount.mountId.length === 0) {
      return { ok: false, code: "invalid-mount-id", detail: "every mount carries a non-empty mountId" };
    }
    if (seenMountIds.has(mount.mountId)) {
      return { ok: false, code: "duplicate-mount", detail: `mount ${mount.mountId} is declared twice` };
    }
    seenMountIds.add(mount.mountId);
    if (!isWebHostWorkbench(mount.workbench)) {
      return { ok: false, code: "unknown-workbench", detail: `mount ${mount.mountId} references unknown workbench ${String(mount.workbench)}` };
    }
    if (mount.rendered !== false) {
      return { ok: false, code: "honesty-violation", detail: `mount ${mount.mountId} claims rendering — this composition renders nothing (E11)` };
    }
    const required = WORKBENCH_PORTS[mount.workbench];
    const seenPorts = new Set<string>();
    for (const binding of mount.ports) {
      if (!required.includes(binding.port)) {
        return { ok: false, code: "unknown-port", detail: `mount ${mount.mountId} binds ${String(binding.port)}, which is not a documented seam of ${mount.workbench}` };
      }
      if (seenPorts.has(binding.port)) {
        return { ok: false, code: "duplicate-port-binding", detail: `mount ${mount.mountId} binds ${String(binding.port)} twice` };
      }
      seenPorts.add(binding.port);
      if (binding.provider.source === "demo-fixture" && !isWebHostDemoFixture(binding.provider.fixture)) {
        return { ok: false, code: "unknown-fixture", detail: `mount ${mount.mountId} cites unknown demo fixture ${String(binding.provider.fixture)}` };
      }
    }
    for (const port of required) {
      if (!seenPorts.has(port)) {
        return { ok: false, code: "missing-port-binding", detail: `mount ${mount.mountId} does not bind ${port} (required by ${mount.workbench})` };
      }
    }
  }
  return { ok: true, value: mounts };
}
