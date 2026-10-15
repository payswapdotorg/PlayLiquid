/**
 * PLAYLIQUID GAMEOS PRODUCT IDENTITY + local workspace facts (RW-001).
 *
 * The ONE place the desktop product shell records its product identity
 * (name, tagline, navigation vocabulary) and the HOST-OWNED facts of the
 * local single-operator workspace the shell composes: the local tenancy
 * (R20 viewer scope) and the local game project the Game Engineering Lab
 * organizes (the PlayLiquid GameOS product itself, pinned at the build
 * revision — the commit the running app was built from, injected by
 * `packages/desktop/vite.config.ts`).
 *
 * These are HOST composition facts, not domain data: the modules behind
 * the seams never see them unless the host passes them through a typed
 * command (E5/E13). No fixtures, no demo vocabulary — every value below is
 * either the product's own identity or an honestly-declared host catalog.
 */

import type { GameIdentity } from "../../../../../game-contracts/src/index.ts";
import { asCommitSha, asGameId } from "../../../../../game-contracts/src/index.ts";
import { asAgentRoleId, asZCodeModelRouteId } from "../../../../../lab-contracts/src/index.ts";
import { asSubjectId, asTenantId } from "../../../../../platform-contracts/src/index.ts";

/** Build-time commit of the running app (full 40-hex sha; vite define). */
declare const __PLAYLIQUID_GAMEOS_COMMIT__: string | undefined;

/** The product name shown everywhere (window title, navigation, headers). */
export const PRODUCT_NAME = "PlayLiquid GameOS" as const;

/** The product tagline (startup screen + shell subtitle). */
export const PRODUCT_TAGLINE = "The game engineering operating system" as const;

/** The local operator tenancy of the desktop product (R20 viewer scope). */
export const LOCAL_TENANT = asTenantId("tenant-playliquid-local")!;
export const LOCAL_SUBJECT = asSubjectId("subject-local-operator")!;

/**
 * The opaque ZCode model route the desktop host declares for the Lab's
 * model catalog (lock rule 5: the Lab never sees model names — routes are
 * opaque handles resolved by the ZCode model-routing authority). This is
 * the host's route for the local workbench routing; richer catalogs are a
 * host composition follow-up.
 */
export const LOCAL_MODEL_ROUTE = asZCodeModelRouteId("route-workbench-local")!;

/**
 * The local Lab role vocabulary the desktop host offers (its engineering
 * role catalog — a host-owned choice, deliberately the two canonical Lab
 * roles).
 */
export const LOCAL_ROLE_VOCABULARY = [
  asAgentRoleId("generalist")!,
  asAgentRoleId("implementer")!,
] as const;

/** The resolved build commit (40-hex) or undefined when unavailable. */
export function buildCommitSha(): string | undefined {
  const declared =
    typeof __PLAYLIQUID_GAMEOS_COMMIT__ === "undefined" ? undefined : __PLAYLIQUID_GAMEOS_COMMIT__;
  if (declared === undefined || declared === "") return undefined;
  return asCommitSha(declared) === undefined ? undefined : declared;
}

/**
 * The local game project the Lab organizes: the PlayLiquid GameOS product
 * itself, pinned at the build revision. Returns undefined when the build
 * commit is not a valid 40-hex sha (e.g. a dev build without git) — the
 * Lab search admission then refuses honestly instead of fabricating a
 * revision.
 */
export function localProjectIdentity(): GameIdentity | undefined {
  const sha = buildCommitSha();
  if (sha === undefined) return undefined;
  const id = asGameId("game-playliquid-gameos");
  if (id === undefined) return undefined;
  return {
    id,
    displayName: PRODUCT_NAME,
    kind: "toolkit",
    repository: { host: "github.com", owner: "payswapdotorg", repository: "PlayLiquid" },
    revision: { kind: "commit", commit: sha },
    lineage: { head: sha, ancestors: [] },
  };
}

/** The workbench query flag that routes the entry to the ZCode workbench. */
export const WORKBENCH_QUERY_FLAG = "workbench" as const;

/**
 * The URL that opens the ZCode workbench from the product shell: the
 * CURRENT window location plus the workbench flag (all existing query
 * parameters are preserved). The workbench stays fully reachable — it is
 * just not the default product surface (RW-001).
 */
export function workbenchHref(): string {
  const params = new URLSearchParams(window.location.search);
  params.set(WORKBENCH_QUERY_FLAG, "1");
  const suffix = params.toString();
  return suffix === "" ? window.location.pathname : `${window.location.pathname}?${suffix}`;
}

/**
 * The URL that returns from the workbench to the PlayLiquid GameOS
 * product surface: the current location with the workbench flag removed
 * (all other query parameters preserved).
 */
export function productHref(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete(WORKBENCH_QUERY_FLAG);
  const suffix = params.toString();
  return suffix === "" ? window.location.pathname : `${window.location.pathname}?${suffix}`;
}
