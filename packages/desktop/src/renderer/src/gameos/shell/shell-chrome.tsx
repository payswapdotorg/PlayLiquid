/**
 * THE PRODUCT SHELL CHROME (RW-001): the PlayLiquid GameOS top bar — the
 * product identity, the workspace navigation (Game Studio / Lab /
 * Community), the ZCode workbench escape hatch and the REAL window
 * controls (minimize / maximize / close through the platform service's
 * desktop commands — the same authoritative operations the workbench
 * chrome uses; on Linux the bar is the drag region of the frameless
 * window).
 *
 * This component owns NO domain state (E1): the navigation selection is
 * the shell's own presentation state; the workspaces behind it own their
 * stores; the window commands are the platform service's.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DesktopCommandIds, type IPlatformService } from "@zcode/shared";
import { PRODUCT_NAME, PRODUCT_TAGLINE, workbenchHref } from "../identity.ts";
import {
  SHELL_STYLE,
  navButtonStyle,
  type ShellCssProperties,
} from "./shell-tokens.ts";

/** One navigable product workspace of the shell. */
export type ShellWorkspaceId = "studio" | "lab" | "community";

/** The workspace navigation vocabulary (order = display order). */
export const SHELL_WORKSPACES: readonly {
  readonly id: ShellWorkspaceId;
  readonly label: string;
  readonly hint: string;
}[] = Object.freeze([
  { id: "studio", label: "Game Studio", hint: "Packages, runtime sessions, avatars, capabilities, tools" },
  { id: "lab", label: "Lab", hint: "Searches, evidence, learning, guidance, capability gaps, Arena" },
  { id: "community", label: "Community", hint: "Contributions, lifecycle, provenance" },
] as const);

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

/** One REAL window control button (platform desktop command). */
function WindowControlButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void | Promise<void>;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      style={SHELL_STYLE.windowControl}
      aria-label={label}
      title={label}
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
    </button>
  );
}

/** The window controls cluster (Linux/Windows render their own; macOS keeps native). */
function WindowControls({
  platform,
  isMacDesktop,
}: {
  readonly platform: IPlatformService;
  readonly isMacDesktop: boolean;
}): ReactNode {
  const maximized = useMaximized(platform);
  if (isMacDesktop) return null;
  const command = (id: DesktopCommandIds) => platform.executeDesktopCommand(id);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
      <WindowControlButton
        label="Minimize window"
        onClick={() => command(DesktopCommandIds.MinimizeWindow)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </WindowControlButton>
      <WindowControlButton
        label={maximized ? "Restore window" : "Maximize window"}
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

/** The shell top bar: identity + navigation + workbench escape + controls. */
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
  return (
    <div style={SHELL_STYLE.root as ShellCssProperties}>
      <header
        style={{
          ...SHELL_STYLE.bar,
          ...(isMacDesktop ? { paddingLeft: 78 } : {}),
        } as ShellCssProperties}
        data-testid="gameos-shell-bar"
      >
        <div style={SHELL_STYLE.brand}>
          <ProductMark />
          <div>
            <p style={SHELL_STYLE.brandName}>{PRODUCT_NAME}</p>
            <p style={SHELL_STYLE.brandTagline}>{PRODUCT_TAGLINE}</p>
          </div>
        </div>
        <nav
          aria-label="PlayLiquid GameOS workspaces"
          style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}
        >
          {SHELL_WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              style={navButtonStyle(active === workspace.id)}
              title={workspace.hint}
              aria-current={active === workspace.id ? "page" : undefined}
              data-testid={`gameos-nav-${workspace.id}`}
              onClick={() => onSelect(workspace.id)}
            >
              {workspace.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          style={{ ...SHELL_STYLE.workbenchButton, marginLeft: "auto" } as ShellCssProperties}
          title="Open the ZCode workbench — model selection, agents, provider capabilities"
          data-testid="gameos-nav-workbench"
          onClick={onOpenWorkbench}
        >
          ZCode workbench
        </button>
        <WindowControls platform={platform} isMacDesktop={isMacDesktop} />
      </header>
      {children}
    </div>
  );
}

/** The workbench escape hatch target (identity.ts computes the URL). */
export function openWorkbench(): void {
  window.location.href = workbenchHref();
}
