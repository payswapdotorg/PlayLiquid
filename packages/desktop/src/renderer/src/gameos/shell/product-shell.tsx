/**
 * THE PRODUCT SHELL COMPOSITION ROOT (RW-001, restyled UX-001): mounts the
 * PlayLiquid GameOS product — the DEFAULT first-window experience — from the
 * REAL product modules behind the desktop host's REAL port seams.
 *
 * The frozen PL-033/034 mount recipe, executed per module: the host
 * loads the FIRST authoritative snapshot BEFORE the store exists, wires
 * the ports, creates the ONE store per module, then mounts the app.
 * There is no second state owner, registry or workflow engine here: the
 * three module stores own their UI state, the authoritative domain
 * services behind the ports own all domain state (E5/E13 verbatim), and
 * this shell owns only its own navigation selection.
 *
 * Failure discipline (E11): a failed composition is RENDERED, never
 * swallowed — an honest banner with the typed detail and a real retry
 * (re-running the whole composition). No fabricated states, ever.
 *
 * UX-001 rework scope here: presentation only (the shell design system +
 * the shared ShellButton discipline for the retry control). The
 * composition, the kept-mounted HIDDEN display switching, the honest
 * starting/failed states and the ready event are preserved exactly.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { IPlatformService } from "@zcode/shared";
import { createDesktopProductHost } from "../host/desktop-host.ts";
import type { DesktopProductHost } from "../host/desktop-host.ts";
import { StudioApp, createStudioStore } from "../../../../../../game-ui/src/index.ts";
import type { StudioStore } from "../../../../../../game-ui/src/index.ts";
import { LabApp, createLabStore } from "../../../../../../web/gameos-lab/src/index.ts";
import type { LabStore } from "../../../../../../web/gameos-lab/src/index.ts";
import {
  CommunityApp,
  createCommunityStore,
} from "../../../../../../web/gameos-community/src/index.ts";
import type { CommunityStore } from "../../../../../../web/gameos-community/src/index.ts";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../identity.ts";
import { prefersReducedMotion, subscribeReducedMotion } from "./shell-density.ts";
import { ProductMark, ShellButton, ShellChrome, openWorkbench } from "./shell-chrome.tsx";
import type { ShellWorkspaceId } from "./shell-chrome.tsx";
import { SHELL_HOVER, SHELL_SPACE, SHELL_STYLE, SHELL_TYPE } from "./shell-tokens.ts";

/** The fully composed product: the host + the ONE store per module. */
export interface ProductComposition {
  readonly host: DesktopProductHost;
  readonly studio: StudioStore;
  readonly lab: LabStore;
  readonly community: CommunityStore;
}

/** Composes the product: real host first, then the three module stores. */
async function composeProduct(): Promise<ProductComposition> {
  const host = await createDesktopProductHost();
  const studioLoad = host.studio.port.load();
  if (!studioLoad.ok) {
    throw new Error(`Game Studio first snapshot failed: ${studioLoad.detail}`);
  }
  const labLoad = host.lab.data.load();
  if (!labLoad.ok) {
    throw new Error(`Lab first snapshot failed: ${labLoad.detail}`);
  }
  const communityLoad = host.community.data.load();
  if (!communityLoad.ok) {
    throw new Error(`Community first snapshot failed: ${communityLoad.detail}`);
  }
  return {
    host,
    studio: createStudioStore(studioLoad.data, host.studio.port),
    lab: createLabStore(labLoad.data, { data: host.lab.data, command: host.lab.command }),
    community: createCommunityStore(communityLoad.data, {
      data: host.community.data,
      command: host.community.command,
    }),
  };
}

/** The honest detail of an unknown failure (never a fabricated message). */
function detailOf(error: unknown): string {
  return error instanceof Error ? `${String(error.name)}: ${String(error.message)}` : String(error);
}

/** Style for a hidden (kept-mounted) workspace. */
const HIDDEN: Readonly<{ display: "none" }> = Object.freeze({ display: "none" });

/** The ready product: chrome + the three workspaces, all kept mounted. */
function ProductShell({
  composition,
  platform,
  isMacDesktop,
}: {
  readonly composition: ProductComposition;
  readonly platform: IPlatformService;
  readonly isMacDesktop: boolean;
}): ReactNode {
  const [active, setActive] = useState<ShellWorkspaceId>("studio");
  return (
    <ShellChrome
      active={active}
      onSelect={setActive}
      onOpenWorkbench={openWorkbench}
      platform={platform}
      isMacDesktop={isMacDesktop}
    >
      <main style={SHELL_STYLE.workspaceHost} data-testid="gameos-workspace-host">
        <div style={active === "studio" ? undefined : HIDDEN}>
          <StudioApp store={composition.studio} />
        </div>
        <div style={active === "lab" ? undefined : HIDDEN}>
          <LabApp store={composition.lab} />
        </div>
        <div style={active === "community" ? undefined : HIDDEN}>
          <CommunityApp store={composition.community} />
        </div>
      </main>
    </ShellChrome>
  );
}

/** Root state of the product mount: starting → ready | failed. */
type ProductRootState =
  | { readonly status: "starting" }
  | { readonly status: "ready"; readonly composition: ProductComposition }
  | { readonly status: "failed"; readonly detail: string };

/** The product root: composes, renders honest states, retries for real. */
function ProductShellRoot({
  platform,
  isMacDesktop,
}: {
  readonly platform: IPlatformService;
  readonly isMacDesktop: boolean;
}): ReactNode {
  const [state, setState] = useState<ProductRootState>({ status: "starting" });
  const [attempt, setAttempt] = useState(0);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );
  useEffect(() => {
    let cancelled = false;
    setState({ status: "starting" });
    composeProduct()
      .then((composition) => {
        if (!cancelled) setState({ status: "ready", composition });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "failed", detail: detailOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  useEffect(() => {
    // Retire the HTML startup shell once React has committed the product
    // surface (the same ready event the fork's entry dispatches).
    window.dispatchEvent(new Event("zcode-react-startup-ready"));
  }, []);
  if (state.status === "ready") {
    return <ProductShell composition={state.composition} platform={platform} isMacDesktop={isMacDesktop} />;
  }
  if (state.status === "failed") {
    return (
      <div className="gameos-product-root" style={SHELL_STYLE.root} role="alert">
        <p style={SHELL_STYLE.banner} data-testid="gameos-compose-failed">
          {PRODUCT_NAME} failed to compose its product modules (E11): {state.detail}
        </p>
        <ShellButton
          style={SHELL_STYLE.retryButton}
          hoverStyle={SHELL_HOVER.retry}
          reducedMotion={reducedMotion}
          onClick={() => setAttempt((current) => current + 1)}
        >
          retry composition
        </ShellButton>
      </div>
    );
  }
  return (
    <div
      className="gameos-product-root"
      style={{
        ...SHELL_STYLE.root,
        alignItems: "center",
        justifyContent: "center",
        gap: SHELL_SPACE.md,
      }}
      role="status"
      aria-label={`${PRODUCT_NAME} starting`}
    >
      <ProductMark size={44} />
      <p style={{ ...SHELL_STYLE.brandName, ...SHELL_TYPE.startupName }}>{PRODUCT_NAME}</p>
      <p style={SHELL_STYLE.brandTagline}>{PRODUCT_TAGLINE} — starting…</p>
    </div>
  );
}

/**
 * Mounts the PlayLiquid GameOS product shell onto an existing React root
 * (the desktop renderer entry creates the root and routes here for the
 * product surface; the inherited agent workspace stays reachable through
 * its own entry path — the shell's "AI & Agents" escape hatch).
 */
export function mountProductShell(
  root: Root,
  options: {
    readonly platform: IPlatformService;
    readonly isMacDesktop: boolean;
  },
): void {
  root.render(<ProductShellRoot platform={options.platform} isMacDesktop={options.isMacDesktop} />);
}
