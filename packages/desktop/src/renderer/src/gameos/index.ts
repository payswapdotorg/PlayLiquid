/**
 * gameos-product-shell public entrypoint (RW-001, see
 * spec/release/work-items.md): the PlayLiquid GameOS product shell.
 *
 * Public surface: the module manifest, the product identity/host facts,
 * the desktop product host composition (the real domain services + the
 * module port adapters) and the mountable product shell. Cross-module
 * imports go through here or src/contract.ts only; implementation
 * details stay inside the module.
 */
export { gameos_productShellModule } from "./module.ts";

// Product identity + host-owned local workspace facts (identity.ts).
export {
  LOCAL_MODEL_ROUTE,
  LOCAL_ROLE_VOCABULARY,
  LOCAL_SUBJECT,
  LOCAL_TENANT,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  PRODUCT_WORDMARK,
  WORKBENCH_NAV_HINT,
  WORKBENCH_NAV_LABEL,
  WORKBENCH_QUERY_FLAG,
  buildCommitSha,
  localProjectIdentity,
  productHref,
  workbenchHref,
} from "./identity.ts";

// The desktop product host: real domain services + the module ports.
export {
  createDesktopProductHost,
  type DesktopProductHost,
  type DesktopProductHostOptions,
  type DesktopViewer,
} from "./host/desktop-host.ts";

// The module port adapters (the typed seams' desktop implementations).
// NOTE (UX-001): the dead `type StudioDataResult` re-export was removed —
// the adapter declares it as a local import alias only, so the re-export
// never compiled under a real typecheck (latent fork debt; no consumer
// imports it from this entrypoint — game-ui owns that type's export).
export { DesktopStudioDataPort } from "./host/studio-adapter.ts";
export {
  DesktopCommunityCommandPort,
  DesktopCommunityDataPort,
} from "./host/community-adapter.ts";
export {
  DesktopLabCommandPort,
  DesktopLabDataPort,
} from "./host/lab-adapter.ts";

// The mountable product shell.
export {
  mountProductShell,
  type ProductComposition,
} from "./shell/product-shell.tsx";
export { SHELL_WORKSPACES, type ShellWorkspace } from "./shell/shell-workspaces.ts";
export type { ShellWorkspaceId } from "./shell/shell-workspaces.ts";
export { SHELL_FONT, SHELL_STYLE, SHELL_SURFACE } from "./shell/shell-tokens.ts";
