/**
 * THE PRODUCT SHELL CHROME (RW-001, reworked UX-001): the PlayLiquid GameOS
 * top bar — the product identity, the workspace navigation (Game Studio /
 * Lab / Community), the "AI & Agents" escape hatch (the inherited
 * agent-workspace entry, kept fully reachable with the same honest behavior
 * and a PlayLiquid-first label) and the REAL window controls (minimize /
 * maximize / close through the platform service's desktop commands — the
 * same authoritative operations the workbench chrome uses; on Linux the bar
 * is the drag region of the frameless window).
 *
 * Responsive by design (UX-001): the bar picks its density from the LIVE
 * renderer viewport width (JS-driven — the 390x844 emulated viewport
 * resizes the renderer inside the OS window), so at the 480px minimum
 * window and at 390px every navigation control stays reachable (icon-only
 * forms keep their accessible names; see shell-density.ts for the ladder
 * and the pinned width arithmetic).
 *
 * This component owns NO domain state (E1): the navigation selection is
 * the shell's own presentation state; the workspaces behind it own their
 * stores; the window commands are the platform service's.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { DesktopCommandIds, type DesktopCommandId, type IPlatformService } from "@zcode/shared";
import {
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  WORKBENCH_NAV_HINT,
  WORKBENCH_NAV_LABEL,
  workbenchHref,
} from "../identity.ts";
import {
  brandTextForDensity,
  type BarDensity,
  barDensityForViewport,
  prefersReducedMotion,
  SHELL_DENSITY_METRICS,
  SHELL_VIEWPORT_FALLBACK,
  subscribeReducedMotion,
  subscribeViewportWidth,
  viewportWidth,
  workbenchLabelForDensity,
} from "./shell-density.ts";
import { AgentsSparkIcon, WorkspaceIcon } from "./shell-icons.tsx";
import {
  SHELL_HOVER,
  SHELL_STYLE,
  barStyle,
  brandClusterStyle,
  brandNameTextStyle,
  focusRingStyle,
  motionTransition,
  navButtonStyle,
  navClusterStyle,
  windowControlStyle,
  workbenchButtonStyle,
  type ShellCssProperties,
} from "./shell-tokens.ts";
import { SHELL_WORKSPACES, type ShellWorkspaceId } from "./shell-workspaces.ts";

export type { ShellWorkspace } from "./shell-workspaces.ts";
export type { ShellWorkspaceId } from "./shell-workspaces.ts";
export { SHELL_WORKSPACES } from "./shell-workspaces.ts";

/** The macOS traffic-light inset (native controls; the bar clears them). */
const MAC_TRAFFIC_LIGHTS_INSET = 78;

/** The compact product mark (inline SVG; no external asset needed). */
export function ProductMark({ size = 18 }: { readonly size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flex: "0 0 auto", display: "block" }}
    >
      <path
        d="M12 2.4c3.5 3.9 6.4 7.2 6.4 10.6a6.4 6.4 0 1 1-12.8 0C5.6 9.6 8.5 6.3 12 2.4Z"
        fill="#2dd4bf"
        fillOpacity="0.16"
        stroke="#2dd4bf"
        strokeWidth="1.4"
      />
      <path
        d="M9.2 13.4c.2 2 1.6 3.3 3.5 3.5"
        stroke="#2dd4bf"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Subscribes to the platform's window chrome state (maximized or not). */
function useMaximized(platform: IPlatformService): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let disposed = false;
    const unsubscribe = platform.onDesktopWindowChromeStateChanged?.((state) => {
      if (!disposed) setMaximized(state.isMaximized);
    });
    void platform
      .getDesktopWindowChromeState?.()
      .then((state) => {
        if (!disposed) setMaximized(state.isMaximized);
      })
      .catch(() => {
        /* the maximize command still works without the state; keep the icon */
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [platform]);
  return maximized;
}

/**
 * One interactive shell control: a NATIVE button (keyboard Enter/Space
 * activation for free), the no-drag carve-out of the frameless drag bar, a
 * hover treatment, a VISIBLE focus ring driven by the browser's own
 * :focus-visible heuristic (keyboard focus shows the ring; pointer focus
 * does not — the honest equivalent for inline styles), and reduced-motion
 * gating on the added color transition. Exported for the shell's own
 * surfaces (the E11 retry control reuses the exact same discipline).
 */
export function ShellButton({
  testId,
  title,
  ariaLabel,
  ariaCurrent,
  onClick,
  style,
  hoverStyle,
  reducedMotion,
  children,
}: {
  readonly testId?: string;
  readonly title?: string;
  readonly ariaLabel?: string;
  readonly ariaCurrent?: "page";
  readonly onClick: () => void;
  readonly style: ShellCssProperties;
  readonly hoverStyle?: ShellCssProperties;
  readonly reducedMotion: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      style={{
        ...style,
        ...(hovered && hoverStyle !== undefined ? hoverStyle : undefined),
        ...focusRingStyle(focused),
        transition: motionTransition(reducedMotion),
      }}
      onFocus={() => {
        // The ring shows for ANY focus. The browser's :focus-visible
        // heuristic can lag a frame in synthesized-input environments
        // (live-caught by the UX-003 packaged harness: keyboard focus
        // arrived, :focus-visible read true afterwards, but the
        // matches() check at event time had already returned false —
        // a missing keyboard ring is an a11y defect; a ring on mouse
        // focus is a harmless over-application many products ship).
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** One REAL window control button (platform desktop command). */
function WindowControlButton({
  label,
  onClick,
  density,
  reducedMotion,
  close = false,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void | Promise<unknown>;
  readonly density: BarDensity;
  readonly reducedMotion: boolean;
  readonly close?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ShellButton
      title={label}
      ariaLabel={label}
      style={windowControlStyle(density)}
      hoverStyle={close ? SHELL_HOVER.controlClose : SHELL_HOVER.control}
      reducedMotion={reducedMotion}
      onClick={() => {
        try {
          const outcome = onClick();
          if (outcome instanceof Promise) {
            outcome.catch(() => {
              /* the command result is the platform's; failures are not faked */
            });
          }
        } catch {
          /* platform bridge unavailable — an honest no-op, never a fake success */
        }
      }}
    >
      {children}
    </ShellButton>
  );
}

/** The window controls cluster (Linux/Windows render their own; macOS keeps native). */
function WindowControls({
  platform,
  isMacDesktop,
  density,
  reducedMotion,
}: {
  readonly platform: IPlatformService;
  readonly isMacDesktop: boolean;
  readonly density: BarDensity;
  readonly reducedMotion: boolean;
}): ReactNode {
  const maximized = useMaximized(platform);
  if (isMacDesktop) return null;
  const command = (id: DesktopCommandId) => platform.executeDesktopCommand(id);
  const gap = SHELL_DENSITY_METRICS[density].controlGap;
  return (
    <div style={{ display: "flex", alignItems: "center", gap, marginLeft: "auto", flex: "0 0 auto" }}>
      <WindowControlButton
        label="Minimize window"
        density={density}
        reducedMotion={reducedMotion}
        onClick={() => command(DesktopCommandIds.MinimizeWindow)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </WindowControlButton>
      <WindowControlButton
        label={maximized ? "Restore window" : "Maximize window"}
        density={density}
        reducedMotion={reducedMotion}
        onClick={() => command(DesktopCommandIds.ToggleMaximizeWindow)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect
            x="1.7"
            y="1.7"
            width={maximized ? 6.2 : 8.6}
            height={maximized ? 6.2 : 8.6}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </WindowControlButton>
      <WindowControlButton
        label="Close window"
        density={density}
        reducedMotion={reducedMotion}
        close
        onClick={() => command(DesktopCommandIds.CloseWindow)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.2 2.2l7.6 7.6M9.8 2.2l-7.6 7.6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </WindowControlButton>
    </div>
  );
}

/** The shell top bar: identity + navigation + escape hatch + controls. */
export function ShellChrome({
  active,
  onSelect,
  onOpenWorkbench,
  platform,
  isMacDesktop,
  children,
}: {
  readonly active: ShellWorkspaceId;
  readonly onSelect: (workspace: ShellWorkspaceId) => void;
  readonly onOpenWorkbench: () => void;
  readonly platform: IPlatformService;
  readonly isMacDesktop: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const width = useSyncExternalStore(
    subscribeViewportWidth,
    viewportWidth,
    () => SHELL_VIEWPORT_FALLBACK,
  );
  const density = barDensityForViewport(width);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );
  const metrics = SHELL_DENSITY_METRICS[density];
  const workbenchLabel = workbenchLabelForDensity(density);
  return (
    <div style={SHELL_STYLE.root as ShellCssProperties}>
      <header
        style={{
          ...barStyle(density),
          ...(isMacDesktop ? { paddingLeft: MAC_TRAFFIC_LIGHTS_INSET } : {}),
        } as ShellCssProperties}
        data-testid="gameos-shell-bar"
      >
        <div
          style={brandClusterStyle(density)}
          data-testid="gameos-shell-brand"
          title={`${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`}
        >
          <ProductMark size={metrics.markSize} />
          <span style={brandNameTextStyle()}>{brandTextForDensity(density)}</span>
        </div>
        <nav aria-label="PlayLiquid GameOS workspaces" style={navClusterStyle(density)}>
          {SHELL_WORKSPACES.map((workspace) => (
            <ShellButton
              key={workspace.id}
              testId={`gameos-nav-${workspace.id}`}
              title={workspace.hint}
              ariaLabel={density === "full" ? undefined : workspace.label}
              ariaCurrent={active === workspace.id ? "page" : undefined}
              style={navButtonStyle(active === workspace.id, density)}
              hoverStyle={active === workspace.id ? SHELL_HOVER.navActive : SHELL_HOVER.navIdle}
              reducedMotion={reducedMotion}
              onClick={() => onSelect(workspace.id)}
            >
              <WorkspaceIcon icon={workspace.icon} />
              {density === "full" ? <span>{workspace.label}</span> : null}
            </ShellButton>
          ))}
        </nav>
        <ShellButton
          testId="gameos-nav-workbench"
          title={WORKBENCH_NAV_HINT}
          ariaLabel={workbenchLabel === undefined ? WORKBENCH_NAV_LABEL : undefined}
          style={workbenchButtonStyle(density)}
          hoverStyle={SHELL_HOVER.escape}
          reducedMotion={reducedMotion}
          onClick={onOpenWorkbench}
        >
          <AgentsSparkIcon />
          {workbenchLabel === undefined ? null : <span>{workbenchLabel}</span>}
        </ShellButton>
        <WindowControls
          platform={platform}
          isMacDesktop={isMacDesktop}
          density={density}
          reducedMotion={reducedMotion}
        />
      </header>
      {children}
    </div>
  );
}

/** The workbench escape hatch target (identity.ts computes the URL). */
export function openWorkbench(): void {
  window.location.href = workbenchHref();
}
